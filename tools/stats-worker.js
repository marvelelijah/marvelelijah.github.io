/*
  Visitor stats for elijahhalford.com/admin, from Cloudflare Web Analytics.

  Cloudflare's analytics API can't be called straight from a web page, so this small
  Cloudflare Worker sits in between. The admin page sends it your GitHub access key;
  the Worker only answers if that key can edit the website's repository (so only you
  can see the numbers), then asks Cloudflare for the stats and passes them back.

  Set-up (once, all in the Cloudflare dashboard — the README has the click-by-click):
    Workers & Pages → Create → Worker → paste this file → Deploy, then under
    Settings → Variables and Secrets add:
      CF_API_TOKEN   (secret)  an API token with  Account › Account Analytics › Read
      CF_ACCOUNT_ID  (text)    your Cloudflare account ID
      CF_SITE_TAG    (text)    the Web Analytics site tag for elijahhalford.com
  and paste the Worker's address (https://….workers.dev) into /admin → stats.
*/

const REPO = 'marvelelijah/marvelelijah.github.io';
const ALLOWED_ORIGINS = ['https://elijahhalford.com', 'https://www.elijahhalford.com', 'https://marvelelijah.github.io'];
const verified = new Map(); // GitHub key fingerprint -> time it was checked

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply(405, { error: 'GET only' });
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_SITE_TAG) {
      return reply(500, { error: 'the Worker is missing CF_API_TOKEN, CF_ACCOUNT_ID or CF_SITE_TAG' });
    }

    // only someone whose GitHub key can edit the site's repo gets the numbers
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!key) return reply(401, { error: 'no access key sent' });
    const fp = await fingerprint(key);
    const seen = verified.get(fp);
    if (!seen || Date.now() - seen > 10 * 60 * 1000) {
      const gh = await fetch('https://api.github.com/repos/' + REPO, {
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/vnd.github+json', 'User-Agent': 'elijahhalford-stats' },
      });
      const repo = gh.ok ? await gh.json() : null;
      if (!repo || !repo.permissions || !repo.permissions.push) return reply(403, { error: 'that access key cannot edit ' + REPO });
      verified.set(fp, Date.now());
    }

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10) || 7));
    const until = new Date();
    const since = new Date(until.getTime() - days * 86400000);
    // the same filter the Cloudflare dashboard uses: a time range, and this one site
    const q = v => JSON.stringify(String(v));
    const filter = '{ AND: [{ datetime_geq: ' + q(since.toISOString()) + ', datetime_leq: ' + q(until.toISOString()) + ' }, ' +
      '{ OR: [{ siteTag: ' + q(env.CF_SITE_TAG) + ' }] }] }';
    const group = (alias, dim, limit, order) =>
      alias + ': rumPageloadEventsAdaptiveGroups(filter: ' + filter + ', limit: ' + limit + ', orderBy: [' + order + ']) { count sum { visits }' +
      (dim ? ' dimensions { metric: ' + dim + ' }' : '') + ' }';
    const query = 'query Stats($account: String!) { viewer { accounts(filter: { accountTag: $account }) { ' +
      [
        group('total', null, 1, 'count_DESC'),
        group('days', 'date', 100, 'date_ASC'),
        group('pages', 'requestPath', 15, 'count_DESC'),
        group('referrers', 'refererHost', 15, 'count_DESC'),
        group('countries', 'countryName', 15, 'count_DESC'),
        group('devices', 'deviceType', 5, 'count_DESC'),
        group('browsers', 'userAgentBrowser', 8, 'count_DESC'),
      ].join(' ') + ' } } }';

    const cf = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID } }),
    });
    const out = await cf.json().catch(() => null);
    if (!cf.ok || !out || (out.errors && out.errors.length)) {
      return reply(502, { error: 'Cloudflare said: ' + ((out && out.errors && out.errors.map(e => e.message).join('; ')) || cf.status) });
    }
    const acct = (((out.data || {}).viewer || {}).accounts || [])[0] || {};
    const rows = (name, keyName) => (acct[name] || []).map(r => ({
      [keyName]: r.dimensions ? r.dimensions.metric : undefined,
      views: r.count || 0,
      visits: (r.sum && r.sum.visits) || 0,
    }));
    const total = (acct.total || [])[0] || {};
    return reply(200, {
      days,
      since: since.toISOString(),
      until: until.toISOString(),
      total: { views: total.count || 0, visits: (total.sum && total.sum.visits) || 0 },
      byDay: rows('days', 'date'),
      pages: rows('pages', 'path'),
      referrers: rows('referrers', 'host'),
      countries: rows('countries', 'country'),
      devices: rows('devices', 'device'),
      browsers: rows('browsers', 'browser'),
    });
  },
};

async function fingerprint(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
