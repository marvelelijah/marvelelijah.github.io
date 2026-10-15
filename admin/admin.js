/* elijahhalford.com — admin
   Saves straight to the GitHub repo that hosts the site. Every save is one commit:
   new image files + content/content.js + img/manifest.js together.
   Images are resized in the browser (no server, no build step). */
(function(){
'use strict';

/* =====================================================================
   small helpers
   ===================================================================== */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function el(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if(attrs) for(const k in attrs){
    const v = attrs[k];
    if(v == null || v === false) continue;
    if(k === 'class') e.className = v;
    else if(k === 'text') e.textContent = v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(k => { if(k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
  return e;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function slugify(s){
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}
function uniqueSlug(base, taken){
  let s = base, n = 2;
  while(taken.has(s)) s = base + '-' + (n++);
  return s;
}
function uid(){ return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function uniqSorted(arr){ return Array.from(new Set(arr.filter(Boolean).map(s => String(s).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)); }
function fillDatalist(id, values){
  const dl = document.getElementById(id);
  dl.innerHTML = '';
  values.forEach(v => dl.appendChild(el('option', { value: v })));
}

/* activity log */
const logEl = $('#log');
function log(msg, kind){
  const t = new Date().toTimeString().slice(0, 8);
  const line = el('div', { class: 'log-line ' + (kind || '') }, el('span', { class: 't', text: t }), msg);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  mirrorLog(line);
  // lines are updated later (e.g. "publishing…" → "live ✓"): keep the strip in step
  new MutationObserver(() => { if(logEl.lastElementChild === line) mirrorLog(line); }).observe(line, { childList: true, characterData: true, subtree: true, attributes: true });
  return line;
}
function mirrorLog(line){
  const strip = document.getElementById('logLatest');
  if(!strip) return;
  strip.textContent = line.textContent.replace(/^\d\d:\d\d:\d\d/, '').trim() + '   · activity ↗';
  strip.className = 'log-latest ' + line.className.replace('log-line', '').trim();
  // shown on every tab except home, where the full activity list already is
  const home = document.querySelector('[data-view="home"]');
  strip.hidden = !home || !home.hidden;
}
$('#logClear').addEventListener('click', () => { logEl.innerHTML = ''; });

/* =====================================================================
   settings + access key
   ===================================================================== */
const CFG_KEY = 'eh-admin-cfg';
const TOKEN_KEY = 'eh-admin-token';
const cfg = Object.assign({ owner: 'marvelelijah', repo: 'marvelelijah.github.io', branch: 'main' }, (() => {
  try{ return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }catch(e){ return {}; }
})());
let token = '';
try{ token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; }catch(e){}

function saveCfg(){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} }
function storeToken(t, remember){
  token = t;
  try{
    localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
    if(t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  }catch(e){}
}

/* =====================================================================
   GitHub
   ===================================================================== */
const API = 'https://api.github.com';
class GhError extends Error{ constructor(status, msg){ super(msg || ('GitHub error ' + status)); this.status = status; } }

async function gh(path, opts){
  opts = opts || {};
  const headers = {
    'Accept': opts.accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if(token) headers['Authorization'] = 'Bearer ' + token;
  if(opts.body) headers['Content-Type'] = 'application/json';
  let res;
  try{
    res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
  }catch(e){
    throw new GhError(0, "couldn't reach GitHub — check your connection");
  }
  if(!res.ok){
    let msg = '';
    try{ msg = (await res.json()).message || ''; }catch(e){}
    if(res.status === 401) msg = 'the access key was rejected (expired or mistyped?)';
    if(res.status === 403 && !msg) msg = "the access key isn't allowed to do that";
    throw new GhError(res.status, msg);
  }
  if(res.status === 204) return null;
  return (opts.accept || '').includes('raw') ? res.text() : res.json();
}
const repoPath = () => '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

async function readText(path, ref){
  return gh(repoPath() + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent(ref || cfg.branch), { accept: 'application/vnd.github.raw+json' });
}

/* content/content.js and img/manifest.js are plain JSON wrapped in one line of JS */
const CONTENT_PATH = 'content/content.js';
const MANIFEST_PATH = 'img/manifest.js';
const CONTENT_HEAD = '/* Site content, edited by the admin page (/admin). Everything after SITE_CONTENT must stay valid JSON. */\nwindow.SITE_CONTENT = ';
function parseWrapped(text, marker){
  const i = text.indexOf(marker);
  if(i < 0) throw new Error('unexpected format in ' + marker);
  return JSON.parse(text.slice(i + marker.length).trim().replace(/;\s*$/, ''));
}
function parseContent(text){
  const c = parseWrapped(text, 'SITE_CONTENT =');
  c.photos = c.photos || {};
  ['film', 'digital', 'stills'].forEach(k => { c.photos[k] = c.photos[k] || []; });
  c.links = c.links || []; c.music = c.music || []; c.blog = c.blog || []; c.videos = c.videos || [];
  c.files = c.files || {};   // files attached to blog posts, by name in files/
  c.pages = c.pages || {};
  c.pages.about = c.pages.about || { header: '', body: '' };
  if(typeof c.pages.equipment !== 'string') c.pages.equipment = '';
  if(typeof c.pages.contact !== 'string') c.pages.contact = '';
  c.analytics = c.analytics || {};   // { beacon: Cloudflare Web Analytics token, worker: stats Worker URL }
  return c;
}
function serializeContent(c){ return CONTENT_HEAD + JSON.stringify(c, null, 1) + ';\n'; }
function parseManifest(text){ return parseWrapped(text, 'IMG_MANIFEST='); }
function sortKeys(o){ const out = {}; Object.keys(o).sort().forEach(k => { out[k] = o[k]; }); return out; }
function serializeManifest(m){
  const sorted = {};
  Object.keys(m).sort().forEach(k => { sorted[k] = sortKeys(m[k]); });
  return '/* generated by tools/optimize_images.py, do not edit */\nwindow.IMG_MANIFEST=' + JSON.stringify(sorted) + ';\n';
}

function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* the site data as last loaded from GitHub */
let content = null, manifest = null, headSha = null;

async function loadData(){
  const ref = await gh(repoPath() + '/git/ref/heads/' + encodeURIComponent(cfg.branch));
  headSha = ref.object.sha;
  const [ct, mt] = await Promise.all([readText(CONTENT_PATH, headSha), readText(MANIFEST_PATH, headSha)]);
  content = parseContent(ct);
  manifest = parseManifest(mt);
  renderAll();
  refreshUndo();
  loadRecent();
}

/* One save = one commit. `build(content, manifest)` edits fresh copies of the data
   (read at the exact commit we build on) and returns any image files to add or
   delete. If someone else saved in the meantime, it re-reads and tries again. */
let saving = Promise.resolve();
function commit(message, build){
  const run = async () => {
    setBusy(true);
    const blobCache = new Map();
    try{
      for(let attempt = 1; attempt <= 3; attempt++){
        const ref = await gh(repoPath() + '/git/ref/heads/' + encodeURIComponent(cfg.branch));
        const base = ref.object.sha;
        const baseCommit = await gh(repoPath() + '/git/commits/' + base);
        const [ct, mt] = await Promise.all([readText(CONTENT_PATH, base), readText(MANIFEST_PATH, base)]);
        const c = parseContent(ct), m = parseManifest(mt);
        const extra = (await build(c, m)) || [];
        // keep every share page in step with what this save changed
        const taken = new Set(extra.map(f => f.path));
        sharePageChanges(parseContent(ct), parseManifest(mt), c, m).forEach(f => { if(!taken.has(f.path)) extra.push(f); });
        const tree = [];
        for(const f of extra){
          if(f.delete){ tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
          let sha = blobCache.get(f.path);
          if(!sha){
            const b64 = await blobToBase64(f.blob);
            sha = (await gh(repoPath() + '/git/blobs', { method: 'POST', body: { content: b64, encoding: 'base64' } })).sha;
            blobCache.set(f.path, sha);
          }
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha });
        }
        const newContent = serializeContent(c), newManifest = serializeManifest(m);
        if(newContent !== ct) tree.push({ path: CONTENT_PATH, mode: '100644', type: 'blob', content: newContent });
        if(newManifest !== mt) tree.push({ path: MANIFEST_PATH, mode: '100644', type: 'blob', content: newManifest });
        if(!tree.length){ log('nothing changed', 'dim'); return null; }
        const newTree = await gh(repoPath() + '/git/trees', { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
        const newCommit = await gh(repoPath() + '/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [base] } });
        try{
          await gh(repoPath() + '/git/refs/heads/' + encodeURIComponent(cfg.branch), { method: 'PATCH', body: { sha: newCommit.sha, force: false } });
        }catch(e){
          if(e.status === 422 && attempt < 3){ log('the site changed while saving — trying again…', 'dim'); continue; }
          throw e;
        }
        content = c; manifest = m; headSha = newCommit.sha;
        lastSave = { sha: newCommit.sha, message, parent: base };
        $('#undoSave').disabled = false; $('#undoSave').title = 'undo: ' + message.replace(UNDO_PREFIX, '');
        log('saved ✓ ' + message + '  (' + newCommit.sha.slice(0, 7) + ')', 'ok');
        watchDeploy(newCommit.sha);
        renderAll();
        loadRecent();
        return newCommit.sha;
      }
    }catch(e){
      log('not saved: ' + e.message, 'err');
      throw e;
    }finally{
      setBusy(false);
    }
  };
  const p = saving.then(run, run);
  saving = p.catch(() => {});
  return p;
}

/* Undo the last save: a new commit that puts every file back the way it was before
   the most recent change, as long as that change was made here in the admin. */
const UNDO_PREFIX = /^admin: /;
let lastSave = null;   // { sha, message } of the newest commit, when the admin made it
async function refreshUndo(){
  const b = $('#undoSave');
  try{
    const head = await gh(repoPath() + '/git/commits/' + headSha);
    lastSave = UNDO_PREFIX.test(head.message) && head.parents.length ? { sha: head.sha, message: head.message, parent: head.parents[0].sha } : null;
  }catch(e){ lastSave = null; }
  b.disabled = !lastSave;
  b.title = lastSave ? 'undo: ' + lastSave.message.replace(UNDO_PREFIX, '').split('\n')[0] : 'the last change to the site was not made here, so it can only be undone on GitHub';
}
$('#undoSave').addEventListener('click', () => {
  if(!lastSave) return;
  const what = lastSave.message.replace(UNDO_PREFIX, '').split('\n')[0];
  if(!confirm('Undo the last save?\n\n' + what + '\n\nEverything goes back to how it was just before it.')) return;
  const run = async () => {
    setBusy(true);
    try{
      const ref = await gh(repoPath() + '/git/ref/heads/' + encodeURIComponent(cfg.branch));
      if(ref.object.sha !== lastSave.sha) throw new Error('the site changed since — reload the admin and try again');
      const before = await gh(repoPath() + '/git/commits/' + lastSave.parent);
      const nc = await gh(repoPath() + '/git/commits', { method: 'POST', body: { message: (what.startsWith('undo ') ? 'admin: redo ' + what.slice(5).replace(/^“|”$/g, '') : 'admin: undo “' + what + '”'), tree: before.tree.sha, parents: [lastSave.sha] } });
      await gh(repoPath() + '/git/refs/heads/' + encodeURIComponent(cfg.branch), { method: 'PATCH', body: { sha: nc.sha, force: false } });
      log('undone ✓ ' + what + '  (' + nc.sha.slice(0, 7) + ')', 'ok');
      watchDeploy(nc.sha);
      await loadData();
    }catch(e){ log('not undone: ' + e.message, 'err'); }
    finally{ setBusy(false); }
  };
  saving = saving.then(run, run);
});

/* tell the owner when GitHub Pages has published the commit */
async function watchDeploy(sha){
  const line = log('publishing to the website…', 'dim');
  for(let i = 0; i < 40; i++){
    await sleep(i === 0 ? 8000 : 10000);
    let runs;
    try{
      runs = await gh(repoPath() + '/actions/runs?head_sha=' + sha + '&per_page=5');
    }catch(e){
      line.lastChild.textContent = 'publishing — usually live within 2–3 minutes.';
      return;
    }
    const run = (runs.workflow_runs || [])[0];
    if(!run) continue;
    if(run.status === 'completed'){
      if(run.conclusion === 'success'){ line.className = 'log-line ok'; line.lastChild.textContent = 'live on the website ✓ (refresh the site to see it)'; }
      else{ line.className = 'log-line err'; line.lastChild.textContent = 'GitHub had trouble publishing (' + run.conclusion + '). Saving anything again usually fixes it.'; }
      return;
    }
  }
  line.lastChild.textContent = 'still publishing — check the site in a few minutes.';
}

let busyCount = 0;
function setBusy(on){
  busyCount += on ? 1 : -1;
  document.body.classList.toggle('busy', busyCount > 0);
  $$('.btn.primary').forEach(b => { b.disabled = busyCount > 0; });
  updateConn();
}

/* =====================================================================
   images: resize in the browser to the same sizes the site expects
   ===================================================================== */
const WIDTHS = { photo: [480, 960, 1600, 2400], cover: [300, 600, 1000], post: [960, 1600], vthumb: [640, 1280] };
let encodeFmt = null;
async function pickFormat(){
  if(encodeFmt) return encodeFmt;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const b = await new Promise(r => c.toBlob(r, 'image/webp', 0.8));
  // Safari can't make WebP from a canvas; fall back to JPEG there
  encodeFmt = (b && b.type === 'image/webp') ? { type: 'image/webp', ext: 'webp', q: 0.8 } : { type: 'image/jpeg', ext: 'jpg', q: 0.86 };
  return encodeFmt;
}
async function decodeImage(file){
  if(window.createImageBitmap){
    try{ return await createImageBitmap(file, { imageOrientation: 'from-image' }); }catch(e){}
    try{ return await createImageBitmap(file); }catch(e){}
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try{ await img.decode(); }catch(e){ throw new Error("this file couldn't be opened as an image (HEIC? export it as JPEG)"); }
  return img;
}
const dimsOf = src => [src.naturalWidth || src.width, src.naturalHeight || src.height];
function drawTo(src, w, h){
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}
// halve repeatedly, then a final high-quality step: much sharper than one big jump
function resizeTo(src, tw, th){
  let [w, h] = dimsOf(src), cur = src;
  while(w / 2 >= tw){
    const nw = Math.max(tw, Math.round(w / 2)), nh = Math.max(th, Math.round(h / 2));
    cur = drawTo(cur, nw, nh); w = nw; h = nh;
  }
  return (w === tw && h === th && cur instanceof HTMLCanvasElement) ? cur : drawTo(cur, tw, th);
}
const canvasBlob = (c, fmt) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('could not encode image')), fmt.type, fmt.q));

/* -> { id, ext, entry (manifest), files:[{path, blob}], previewUrl, width, height } */
async function processImage(file, role, id){
  id = id || uid();
  const fmt = await pickFormat();
  const src = await decodeImage(file);
  const [w0, h0] = dimsOf(src);
  if(!w0 || !h0) throw new Error('empty image');
  const made = [], files = [];
  let smallest = null;
  for(const w of WIDTHS[role]){
    if(w > w0 && made.length) break;
    const tw = Math.min(w, w0), th = Math.round(h0 * tw / w0);
    const c = resizeTo(src, tw, th);
    if(!smallest) smallest = c;
    files.push({ path: 'img/p/' + id + '-' + w + '.' + fmt.ext, blob: await canvasBlob(c, fmt) });
    made.push(w);
  }
  // tiny blurred preview shown while the real image loads
  const s = Math.min(24 / w0, 24 / h0);
  const lq = drawTo(smallest, Math.max(1, Math.round(w0 * s)), Math.max(1, Math.round(h0 * s)));
  const b = lq.toDataURL(fmt.type, fmt.ext === 'webp' ? 0.4 : 0.5);
  const entry = { w: made, r: Math.round(w0 / h0 * 10000) / 10000, b };
  if(fmt.ext !== 'webp') entry.x = fmt.ext;
  if(src.close) try{ src.close(); }catch(e){}
  return { id, ext: fmt.ext, entry, files, previewUrl: URL.createObjectURL(files[0].blob), width: w0, height: h0 };
}
function imageFilesFor(id, m){
  const e = m[id];
  if(!e) return [];
  return e.w.map(w => ({ path: 'img/p/' + id + '-' + w + '.' + (e.x || 'webp'), delete: true }));
}
function thumbUrl(id, want){
  if(localPreviews[id]) return localPreviews[id];
  const e = manifest && manifest[id];
  if(!e) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (want || 480);
  let pick = e.w[e.w.length - 1];
  for(const w of e.w){ if(w >= (want || 480)){ pick = w; break; } }
  return '../img/p/' + id + '-' + pick + '.' + (e.x || 'webp');
}
const localPreviews = {}; // images saved this session, shown before the site has redeployed

/* =====================================================================
   EXIF: camera, lens, shutter, aperture, ISO, focal length, date
   ===================================================================== */
function readExif(buf){
  const v = new DataView(buf);
  if(v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null; // JPEG only
  let off = 2;
  while(off + 4 <= v.byteLength){
    const marker = v.getUint16(off);
    if((marker & 0xFF00) !== 0xFF00) break;
    const len = v.getUint16(off + 2);
    if(marker === 0xFFE1 && len > 8 && str(v, off + 4, 4) === 'Exif') return parseTiff(v, off + 10);
    if(marker === 0xFFDA) break;
    off += 2 + len;
  }
  return null;
}
function str(v, off, n){ let s = ''; for(let i = 0; i < n && off + i < v.byteLength; i++){ const c = v.getUint8(off + i); if(!c) break; s += String.fromCharCode(c); } return s; }
function parseTiff(v, start){
  if(start + 8 > v.byteLength) return null;
  const le = v.getUint16(start) === 0x4949;
  const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8 };
  const readIfd = (ifdOff) => {
    const out = {};
    if(ifdOff + 2 > v.byteLength) return out;
    const n = v.getUint16(ifdOff, le);
    for(let i = 0; i < n; i++){
      const e = ifdOff + 2 + i * 12;
      if(e + 12 > v.byteLength) break;
      const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
      const size = (sizes[type] || 1) * count;
      const at = size <= 4 ? e + 8 : start + v.getUint32(e + 8, le);
      if(at + size > v.byteLength) continue;
      let val;
      if(type === 2) val = str(v, at, count).trim();
      else if(type === 3) val = v.getUint16(at, le);
      else if(type === 4) val = v.getUint32(at, le);
      else if(type === 5){ const d = v.getUint32(at + 4, le); val = d ? v.getUint32(at, le) / d : 0; }
      else if(type === 10){ const d = v.getInt32(at + 4, le); val = d ? v.getInt32(at, le) / d : 0; }
      else continue;
      out[tag] = val;
    }
    return out;
  };
  const ifd0 = readIfd(start + v.getUint32(start + 4, le));
  const ex = ifd0[0x8769] ? readIfd(start + ifd0[0x8769]) : {};
  return {
    make: ifd0[0x010F] || '', model: ifd0[0x0110] || '', software: ifd0[0x0131] || '',
    exposure: ex[0x829A] || 0, fnumber: ex[0x829D] || 0, iso: ex[0x8827] || 0,
    focal: ex[0x920A] || 0, lensMake: ex[0xA433] || '', lensModel: ex[0xA434] || '',
    date: ex[0x9003] || ifd0[0x0132] || '',
  };
}
const SONY_MODELS = { 'ILCE-7C':'a7c', 'ILCE-7CM2':'a7c ii', 'ILCE-7CR':'a7cr', 'ILCE-7M3':'a7 iii', 'ILCE-7M4':'a7 iv',
  'ILCE-7RM3':'a7r iii', 'ILCE-7RM4':'a7r iv', 'ILCE-7RM5':'a7r v', 'ILCE-7SM3':'a7s iii', 'ILCE-1':'a1', 'ILCE-9':'a9',
  'ILME-FX3':'alpha fx3', 'ILME-FX30':'fx30', 'ILCE-6400':'a6400', 'ILCE-6600':'a6600', 'ILCE-6700':'a6700', 'ZV-E10':'zv-e10' };
const SCANNER_HINTS = /noritsu|frontier|epson|plustek|pakon|imacon|flextight|silverfast|vuescan|coolscan|nikon scan|scanner/i;
function prettyCamera(x){
  if(!x || !x.model) return '';
  let make = x.make.toLowerCase().replace(/corporation|co\.,? ?ltd\.?|inc\.?/g, '').trim();
  if(make.includes('sony')) return 'sony ' + (SONY_MODELS[x.model.toUpperCase()] || x.model.toLowerCase());
  // Canon writes "EOS M50m2" for the M50 Mark II, "EOS R6m2" for the R6 Mark II, etc.
  let model = x.model.toLowerCase().replace(/m([2-5])$/, (m0, n) => ' mark ' + ['', '', 'ii', 'iii', 'iv', 'v'][Number(n)]);
  if(make === 'nikon corporation' || make.startsWith('nikon')) make = 'nikon';
  if(make.startsWith('fujifilm')) make = 'fujifilm';
  if(make.startsWith('olympus') || make.startsWith('om digital')) make = 'om system';
  if(make.startsWith('ricoh')) make = 'ricoh';
  if(model.startsWith(make)) return model.replace(/\s+/g, ' ').trim();
  return (make + ' ' + model).replace(/\s+/g, ' ').trim();
}
function prettyLens(x){
  if(!x || !x.lensModel) return '';
  let l = x.lensModel.toLowerCase().replace(/\s+/g, ' ').trim();
  l = l.replace(/\bf(\d+(?:\.\d+)?)/g, 'f/$1').replace(/f\/\//g, 'f/');
  const brand = (x.lensMake || x.make || '').toLowerCase().split(' ')[0];
  if(brand && !l.startsWith(brand) && !/^(sigma|tamron|samyang|viltrox|zeiss|voigtlander|7artisans|ttartisan|meike|rokinon|laowa)/.test(l)) l = brand + ' ' + l;
  return l;
}
function fmtShutter(t){
  if(!t) return '';
  if(t >= 1) return (Math.round(t * 10) / 10) + 's';
  return '1/' + Math.round(1 / t) + 's';
}
function fmtNum(n){ return n ? String(Math.round(n * 10) / 10) : ''; }
function exifDate(x){
  const m = x && String(x.date).match(/^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? ' ' + m[4] + ':' + m[5] + ':' + m[6] : '')) : '';
}
// photo names start with the date: "06-30-26 …" is month-day-year (June 30, 2026).
// If the first number can't be a month (e.g. "30-06-26") it's read as day-month-year.
function dateFromName(name){
  const m = String(name || '').match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{2}|\d{4})(?!\d)/);
  if(!m) return '';
  let mo = Number(m[1]), d = Number(m[2]);
  if(mo > 12 && d <= 12){ const t = mo; mo = d; d = t; }
  if(mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
// the date from the name, plus the exact time from the camera when it's the same day
function bestDate(name, exif){
  const fromName = dateFromName(name), fromCam = exifDate(exif);
  if(fromName) return (fromCam && fromCam.slice(0, 10) === fromName) ? fromCam : fromName;
  return fromCam;
}

/* =====================================================================
   tabs + connection
   ===================================================================== */
let connected = false;
function updateConn(){
  const s = $('#connState');
  if(busyCount > 0){ s.className = 'conn busy'; s.textContent = 'saving…'; return; }
  s.className = 'conn ' + (connected ? 'on' : 'off');
  s.textContent = connected ? 'connected · ' + cfg.repo : 'not connected';
}
/* five sections across the top; information, media and journal each have a row of sub-tabs */
const GROUPS = {
  home: ['home'],
  information: ['about', 'contact', 'equipment'],
  media: ['videos', 'photos'],
  journal: ['blog', 'music', 'links'],
  connect: ['connect'],
};
const VIEW_LABEL = { about: 'about', contact: 'contact', equipment: 'equipment', videos: 'videography', photos: 'photography', blog: 'blog', music: 'music', links: 'time well spent' };
const groupOf = view => Object.keys(GROUPS).find(g => GROUPS[g].includes(view)) || 'home';
let lastInGroup = {};
try{ lastInGroup = JSON.parse(localStorage.getItem('eh-admin-sub') || '{}') || {}; }catch(e){}
function showTab(name){
  if(name === 'stats') name = 'home';
  if(!GROUPS[groupOf(name)].includes(name)) name = 'home';
  if(!connected && name !== 'connect') name = 'connect';
  const group = groupOf(name);
  $$('#tabs .tab-groups button').forEach(b => b.setAttribute('aria-selected', b.dataset.group === group ? 'true' : 'false'));
  const sub = $('#subtabs');
  sub.innerHTML = '';
  sub.hidden = GROUPS[group].length < 2;
  if(!sub.hidden) GROUPS[group].forEach(v => sub.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': v,
    'aria-selected': v === name ? 'true' : 'false', text: VIEW_LABEL[v] || v, onclick: () => showTab(v) })));
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $('#logLatest').hidden = name === 'home' || !$('#logLatest').textContent;
  if(name === 'home'){ loadStats(); loadRecent(); }
  lastInGroup[group] = name;
  try{ localStorage.setItem('eh-admin-tab', name); localStorage.setItem('eh-admin-sub', JSON.stringify(lastInGroup)); }catch(e){}
}
$$('#tabs .tab-groups button').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.group;
  showTab(GROUPS[g].includes(lastInGroup[g]) ? lastInGroup[g] : GROUPS[g][0]);
}));
$('#logLatest').addEventListener('click', () => showTab('home'));

/* home: the website's latest saves, straight from GitHub */
let recentReq = 0;
async function loadRecent(){
  const box = $('#recentChanges');
  if(!connected || !box) return;
  const mine = ++recentReq;
  let list;
  try{ list = await gh(repoPath() + '/commits?sha=' + encodeURIComponent(cfg.branch) + '&per_page=12'); }
  catch(e){ if(mine === recentReq){ box.innerHTML = ''; box.appendChild(el('div', { class: 'dim', text: "couldn't load recent changes: " + e.message })); } return; }
  if(mine !== recentReq) return;
  box.innerHTML = '';
  const ago = iso => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if(!(s >= 0)) return '';
    if(s < 90) return 'just now';
    if(s < 3600) return Math.round(s / 60) + ' min ago';
    if(s < 86400) return Math.round(s / 3600) + ' h ago';
    const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago';
  };
  (list || []).forEach(c => {
    const msg = String((c.commit && c.commit.message) || '').split('\n')[0];
    const mineSave = /^admin: /.test(msg);
    const when = c.commit && (c.commit.committer || c.commit.author) || {};
    box.appendChild(el('div', { class: 'item' },
      el('div', { class: 'item-main' },
        el('div', { class: 'item-title', text: mineSave ? msg.replace(/^admin: /, '') : msg }),
        el('div', { class: 'item-sub', text: [ago(when.date), mineSave ? 'saved here' : 'changed on GitHub', String(c.sha || '').slice(0, 7)].filter(Boolean).join(' · ') }))));
  });
  if(!list || !list.length) box.appendChild(el('div', { class: 'dim', text: 'no changes yet' }));
}

$('#cfgOwner').value = cfg.owner; $('#cfgRepo').value = cfg.repo; $('#cfgBranch').value = cfg.branch;
if(token) $('#tokenInput').value = token;

async function connect(){
  const t = $('#tokenInput').value.trim();
  if(!t){ log('paste your access key first', 'err'); return; }
  cfg.owner = $('#cfgOwner').value.trim() || cfg.owner;
  cfg.repo = $('#cfgRepo').value.trim() || cfg.repo;
  cfg.branch = $('#cfgBranch').value.trim() || cfg.branch;
  saveCfg();
  storeToken(t, $('#rememberToken').checked);
  const btn = $('#connectBtn');
  btn.classList.add('is-busy');
  try{
    const repo = await gh(repoPath());
    if(repo.permissions && !repo.permissions.push) throw new GhError(403, 'this key can read the repository but not save to it — give it "Contents: Read and write"');
    await loadData();
    connected = true;
    updateConn();
    log('connected to ' + cfg.owner + '/' + cfg.repo + ' ✓', 'ok');
    showTab('home');
  }catch(e){
    connected = false;
    updateConn();
    log("couldn't connect: " + e.message, 'err');
    showTab('connect');
  }finally{
    btn.classList.remove('is-busy');
  }
}
$('#connectBtn').addEventListener('click', connect);
$('#tokenInput').addEventListener('keydown', e => { if(e.key === 'Enter') connect(); });
$('#disconnectBtn').addEventListener('click', () => {
  storeToken('', false);
  $('#tokenInput').value = '';
  connected = false; content = null; manifest = null;
  updateConn();
  log('access key removed from this browser', 'dim');
  showTab('connect');
});

window.addEventListener('beforeunload', e => {
  if(photoQueue.length || postDirty() || pagesDirty() || busyCount > 0){ e.preventDefault(); e.returnValue = ''; }
});

/* =====================================================================
   render everything that depends on the data
   ===================================================================== */
function renderAll(){
  if(!content) return;
  const all = [].concat(content.photos.film, content.photos.digital, content.photos.stills);
  fillDatalist('dlCameras', uniqSorted(all.map(p => p.camera)));
  fillDatalist('dlLenses', uniqSorted(all.map(p => p.lens)));
  fillDatalist('dlFilms', uniqSorted(FILM_STOCKS.concat(all.map(p => p.film))));
  fillDatalist('dlLinkAuthors', uniqSorted(content.links.map(l => l.author)));
  fillDatalist('dlLinkCats', uniqSorted(content.links.map(l => l.category)));
  fillDatalist('dlArtists', uniqSorted(content.music.map(a => a.artist)));
  fillDatalist('dlPostTags', uniqSorted(['blog', 'short story'].concat(content.blog.map(p => p.tag))));
  renderPhotoGrid();
  renderVideos();
  renderLinks();
  renderPosts();
  renderAlbums();
  renderPages();
  renderStatsSetup();
}

/* placeholder; the section code below fills these in */
let photoQueue = [];
let postDirty = () => false;
let pagesDirty = () => false;
const FILM_STOCKS = ['kodak portra 160', 'kodak portra 400', 'kodak portra 800', 'kodak gold 200', 'kodak ultramax 400',
  'kodak ektar 100', 'kodak vision3 500t', 'kodak vision3 250d', 'kodak tri-x 400', 'cinestill 50d', 'cinestill 400d',
  'cinestill 800t', 'cinestill 500t', 'fujifilm 400', 'fujifilm superia 400', 'ilford hp5 plus 400', 'ilford delta 100',
  'ilford kentmere pan 400', 'amber t200', 'lomography 800'];
const FILM_FORMATS = ['35mm', 'half-frame', '120', '4x5', 'instant'];

/* =====================================================================
   photos
   ===================================================================== */
const CATS = ['film', 'digital', 'stills'];
let gridCat = 'film';
let fieldSeq = 0;

/* the same set of fields is used for a new photo and for editing one */
function photoFieldsUI(v){
  const n = 'pf' + (++fieldSeq);
  const input = (id, label, val, attrs) => el('div', { class: 'field' },
    el('label', { for: n + id, text: label }),
    el('input', Object.assign({ id: n + id, value: val || '' }, attrs || {})));
  const catBoxes = el('div', { class: 'boxes' }, CATS.map(c => el('label', null,
    el('input', { type: 'radio', name: n + 'cat', value: c, checked: v.cat === c }), el('span', { text: c }))));
  const fmtBoxes = el('div', { class: 'boxes' }, FILM_FORMATS.map(f => el('label', null,
    el('input', { type: 'radio', name: n + 'fmt', value: f, checked: (v.format || '35mm') === f }), el('span', { text: f }))));
  const ex = v.exif || {};
  const filmOnly = el('div', { class: 'film-only' },
    el('div', { class: 'grid2' },
      input('film', 'film stock', v.film, { list: 'dlFilms', placeholder: 'kodak portra 400' }),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'film format' }), fmtBoxes)));
  const node = el('div', { class: 'pfields' },
    el('div', { class: 'field' }, el('span', { class: 'label', text: 'goes in' }), catBoxes),
    el('div', { class: 'grid2' },
      input('file', 'name shown on the site', v.file),
      input('date', 'date taken', (v.date || '').slice(0, 10), { type: 'date' })),
    el('div', { class: 'grid2' },
      input('camera', 'camera', v.camera, { list: 'dlCameras' }),
      input('lens', 'lens', v.lens, { list: 'dlLenses' })),
    filmOnly,
    el('div', { class: 'grid4' },
      input('shutter', 'shutter', ex.shutter, { placeholder: '1/125s' }),
      input('f', 'f-stop', ex.f, { placeholder: '2.8', inputmode: 'decimal' }),
      input('iso', 'iso', ex.iso, { placeholder: '400', inputmode: 'numeric' }),
      input('focal', 'focal length (mm)', ex.focal, { placeholder: '40', inputmode: 'decimal' })),
    el('div', { class: 'field' },
      el('label', { for: n + 'desc', text: 'description' }),
      el('textarea', { id: n + 'desc', rows: 3 }, v.description || '')));
  const sync = () => { filmOnly.hidden = (node.querySelector('input[name="' + n + 'cat"]:checked') || {}).value !== 'film'; };
  catBoxes.addEventListener('change', sync);
  sync();
  const nameIn = node.querySelector('#' + n + 'file'), dateIn = node.querySelector('#' + n + 'date');
  let autoDate = dateIn.value === dateFromName(nameIn.value) || !dateIn.value;
  dateIn.addEventListener('input', () => { autoDate = !dateIn.value; });
  nameIn.addEventListener('input', () => { const d = dateFromName(nameIn.value); if(autoDate && d) dateIn.value = d; });
  const time = (v.date || '').slice(10); // keep the exact time from the camera, if there was one
  return {
    node,
    read(){
      const val = id => (node.querySelector('#' + n + id).value || '').trim();
      const cat = (node.querySelector('input[name="' + n + 'cat"]:checked') || {}).value || 'digital';
      const d = val('date');
      const out = { cat, file: val('file') };
      if(d) out.date = d + (time && d === (v.date || '').slice(0, 10) ? time : '');
      if(val('camera')) out.camera = val('camera');
      if(val('lens')) out.lens = val('lens');
      if(cat === 'film'){
        if(val('film')) out.film = val('film');
        out.format = (node.querySelector('input[name="' + n + 'fmt"]:checked') || {}).value || '35mm';
      }
      const exif = {};
      let sh = val('shutter');
      if(sh){ if(/^[\d./]+$/.test(sh)) sh += 's'; exif.shutter = sh; }
      const f = val('f').replace(/^f\/?/i, ''); if(f) exif.f = f;
      const iso = val('iso').replace(/^iso\s*/i, ''); if(iso) exif.iso = /^\d+$/.test(iso) ? Number(iso) : iso;
      const fl = val('focal').replace(/mm$/i, ''); if(fl) exif.focal = /^\d+(\.\d+)?$/.test(fl) ? Number(fl) : fl;
      if(Object.keys(exif).length) out.exif = exif;
      const desc = node.querySelector('#' + n + 'desc').value.trim();
      if(desc) out.description = desc;
      return out;
    },
  };
}

const photoDrop = $('#photoDrop'), photoInput = $('#photoFiles');
photoDrop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); photoInput.click(); } });
photoInput.addEventListener('change', () => { addPhotoFiles(photoInput.files); photoInput.value = ''; });
['dragenter', 'dragover'].forEach(t => photoDrop.addEventListener(t, e => { e.preventDefault(); photoDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => photoDrop.addEventListener(t, e => { e.preventDefault(); photoDrop.classList.remove('over'); }));
photoDrop.addEventListener('drop', e => { if(e.dataTransfer && e.dataTransfer.files) addPhotoFiles(e.dataTransfer.files); });

/* the photo tools share one window: new photos | camera info */
function showPhotoTool(name){
  $$('#photoToolTabs button').forEach(b => { const on = b.dataset.tool === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('[data-toolpane]').forEach(p => { p.hidden = p.dataset.toolpane !== name; });
  $('#photoToolPath').textContent = '~/admin/photos/' + name;
}
$$('#photoToolTabs button').forEach(b => b.addEventListener('click', () => showPhotoTool(b.dataset.tool)));

function isImageFile(f){ return /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name); }
function addPhotoFiles(list){
  const files = Array.from(list || []);
  const ok = files.filter(isImageFile);
  if(files.length > ok.length) log((files.length - ok.length) + ' file(s) skipped — only jpeg, png or webp (export HEIC/RAW as JPEG first)', 'err');
  ok.forEach(addPhotoCard);
}

async function addPhotoCard(file){
  const item = { id: uid(), file };
  photoQueue.push(item);
  // hold its place in the list now, so cards keep the order the files were dropped in
  const slot = el('div', { class: 'card', text: 'reading ' + file.name + '…' });
  $('#photoQueue').appendChild(slot);
  $('#photoQueueActions').hidden = false;
  let exif = null;
  try{ exif = readExif(await file.slice(0, 512 * 1024).arrayBuffer()); }catch(e){}
  const scanner = exif && SCANNER_HINTS.test([exif.make, exif.model, exif.software].join(' '));
  const fromCamera = exif && exif.model && !scanner;
  const v = {
    cat: fromCamera ? 'digital' : 'film',
    file: file.name,
    date: bestDate(file.name, fromCamera ? exif : null),
  };
  if(fromCamera){
    v.camera = prettyCamera(exif);
    v.lens = prettyLens(exif);
    v.exif = { shutter: fmtShutter(exif.exposure), f: fmtNum(exif.fnumber), iso: exif.iso || '', focal: fmtNum(exif.focal) };
  }
  item.ui = photoFieldsUI(v);
  const preview = el('img', { class: 'card-img', alt: '' });
  preview.src = URL.createObjectURL(file);
  const meta = el('div', { class: 'card-meta', text: file.name + ' · ' + Math.round(file.size / 1024) + ' KB' });
  preview.addEventListener('load', () => { meta.textContent += ' · ' + preview.naturalWidth + '×' + preview.naturalHeight; }, { once: true });
  const exifLine = el('div', { class: 'card-exif', text: fromCamera
    ? 'read from the file: ' + [v.camera, v.lens, v.exif.shutter, v.exif.f && 'f/' + v.exif.f, v.exif.iso && 'iso ' + v.exif.iso].filter(Boolean).join(' · ')
    : (scanner ? 'scanned file — fill in the camera and film by hand' : 'no camera info in this file') });
  item.status = el('div', { class: 'card-status dim', text: 'not published yet' });
  const remove = el('button', { type: 'button', class: 'btn', text: 'remove', onclick: () => {
    photoQueue = photoQueue.filter(x => x !== item);
    item.el.remove();
    $('#photoQueueActions').hidden = photoQueue.length === 0;
  } });
  item.el = el('div', { class: 'card' },
    el('div', { class: 'card-side' }, preview, meta, exifLine, item.status, remove),
    item.ui.node);
  slot.replaceWith(item.el);
}

function setStatus(item, text, kind){ item.status.className = 'card-status ' + (kind || 'dim'); item.status.textContent = text; }

$('#clearPhotos').addEventListener('click', () => {
  if(photoQueue.length && !confirm('Remove all photos waiting to be published?')) return;
  photoQueue = []; $('#photoQueue').innerHTML = ''; $('#photoQueueActions').hidden = true;
});

$('#publishPhotos').addEventListener('click', async () => {
  const items = photoQueue.slice();
  if(!items.length) return;
  if(items.some(it => !it.ui)){ log('still reading the photos — try again in a second', 'dim'); return; }
  for(const it of items){
    it.data = it.ui.read();
    if(!it.data.file){ setStatus(it, 'give it a name first', 'err'); return; }
  }
  const btn = $('#publishPhotos');
  btn.classList.add('is-busy');
  try{
    for(const it of items){
      if(it.img) continue;
      setStatus(it, 'resizing for the web…');
      try{ it.img = await processImage(it.file, 'photo', it.id); }
      catch(e){ setStatus(it, e.message, 'err'); throw e; }
      setStatus(it, 'ready · ' + it.img.files.length + ' sizes');
    }
    items.forEach(it => setStatus(it, 'saving…'));
    const label = items.length === 1 ? 'photo ' + items[0].data.file : items.length + ' photos';
    await commit('admin: add ' + label, (c, m) => {
      const files = [];
      items.slice().reverse().forEach(it => {
        const d = Object.assign({}, it.data);
        const cat = d.cat; delete d.cat;
        c.photos[cat].unshift(Object.assign({ id: it.id }, d));
        m[it.id] = it.img.entry;
        files.push(...it.img.files);
      });
      return files;
    });
    items.forEach(it => { localPreviews[it.id] = it.img.previewUrl; setStatus(it, 'published ✓', 'ok'); });
    gridCat = items[0].data.cat;
    renderPhotoGrid();
    setTimeout(() => {
      photoQueue = photoQueue.filter(x => !items.includes(x));
      items.forEach(it => it.el.remove());
      $('#photoQueueActions').hidden = photoQueue.length === 0;
    }, 1200);
  }catch(e){
    items.forEach(it => { if(!/err/.test(it.status.className)) setStatus(it, 'not published — ' + e.message, 'err'); });
  }finally{
    btn.classList.remove('is-busy');
  }
});

/* existing photos */
$$('#photoCatTabs button').forEach(b => b.addEventListener('click', () => { gridCat = b.dataset.cat; renderPhotoGrid(); }));
function renderPhotoGrid(){
  $$('#photoCatTabs button').forEach(b => b.classList.toggle('on', b.dataset.cat === gridCat));
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  if(!content) return;
  const list = content.photos[gridCat];
  if(!list.length){ grid.appendChild(el('div', { class: 'dim', text: 'no photos here yet' })); return; }
  list.forEach(p => {
    const img = el('img', { alt: '', loading: 'lazy' });
    img.src = thumbUrl(p.id, 480);
    grid.appendChild(el('button', { type: 'button', class: 'pthumb', title: p.displayName || p.file, onclick: () => openPhotoDialog(gridCat, p.id) },
      img, el('span', { class: 'cap', text: p.displayName || p.file })));
  });
}

const dialog = $('#photoDialog');
let dialogState = null;
function openPhotoDialog(cat, id){
  const p = content.photos[cat].find(x => x.id === id);
  if(!p) return;
  const ui = photoFieldsUI(Object.assign({ cat }, p, { file: p.displayName || p.file, date: p.date || dateFromName(p.file) }));
  dialogState = { cat, id, ui };
  $('#photoDialogTitle').textContent = 'edit · ' + (p.displayName || p.file);
  const body = $('#photoDialogBody');
  body.innerHTML = '';
  const img = el('img', { alt: '', class: 'card-img', style: 'width:100%;height:260px;margin-bottom:12px' });
  img.src = thumbUrl(id, 960);
  body.appendChild(img);
  body.appendChild(ui.node);
  if(dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}
function closeDialog(){ if(dialog.close) dialog.close(); else dialog.removeAttribute('open'); dialogState = null; }
$('#photoDialogClose').addEventListener('click', closeDialog);
$('#photoDialogSave').addEventListener('click', async () => {
  if(!dialogState) return;
  const { cat, id, ui } = dialogState;
  const d = ui.read();
  if(!d.file){ log('the photo needs a name', 'err'); return; }
  try{
    await commit('admin: edit photo ' + d.file, (c) => {
      const list = c.photos[cat];
      const i = list.findIndex(x => x.id === id);
      if(i < 0) throw new Error('that photo was removed somewhere else');
      const old = list[i];
      const entry = Object.assign({ id }, d);
      delete entry.cat;
      // keep the original filename (dates/sorting) and show the new name instead
      if(old.file && d.file !== old.file){ entry.file = old.file; entry.displayName = d.file; }
      else if(old.displayName && d.file === old.displayName){ entry.file = old.file; entry.displayName = old.displayName; }
      if(d.cat === cat) list[i] = entry;
      else{ list.splice(i, 1); c.photos[d.cat].unshift(entry); }
    });
    closeDialog();
  }catch(e){}
});
$('#photoDialogDelete').addEventListener('click', async () => {
  if(!dialogState) return;
  const { cat, id } = dialogState;
  const p = content.photos[cat].find(x => x.id === id);
  if(!confirm('Delete "' + (p.displayName || p.file) + '" from the website? This also deletes its image files.')) return;
  try{
    await commit('admin: delete photo ' + (p.displayName || p.file), (c, m) => {
      c.photos[cat] = c.photos[cat].filter(x => x.id !== id);
      const files = imageFilesFor(id, m);
      delete m[id];
      return files;
    });
    closeDialog();
  }catch(e){}
});

/* =====================================================================
   camera info from original files (for photos already on the site)
   ===================================================================== */
let exifMatches = [];
const exifDrop = $('#exifDrop'), exifInput = $('#exifFiles');
exifDrop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); exifInput.click(); } });
exifInput.addEventListener('change', () => { readOriginals(exifInput.files); exifInput.value = ''; });
['dragenter', 'dragover'].forEach(t => exifDrop.addEventListener(t, e => { e.preventDefault(); exifDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => exifDrop.addEventListener(t, e => { e.preventDefault(); exifDrop.classList.remove('over'); }));
exifDrop.addEventListener('drop', e => { if(e.dataTransfer && e.dataTransfer.files) readOriginals(e.dataTransfer.files); });
$('#exifCancel').addEventListener('click', () => { exifMatches = []; $('#exifResult').hidden = true; });

const baseName = n => String(n || '').toLowerCase().replace(/\.[a-z0-9]+$/i, '').trim();

async function readOriginals(list){
  if(!content){ log('connect first', 'err'); return; }
  const files = Array.from(list || []).filter(f => /\.(jpe?g)$/i.test(f.name) || f.type === 'image/jpeg');
  if(!files.length){ log('drop JPEG originals (the camera info lives in JPEGs)', 'err'); return; }
  // every photo on the site, by name
  const byName = new Map();
  CATS.forEach(cat => content.photos[cat].forEach(p => {
    [p.file, p.displayName].filter(Boolean).forEach(nm => { if(!byName.has(baseName(nm))) byName.set(baseName(nm), { cat, id: p.id, p }); });
  }));
  const line = log('reading ' + files.length + ' files…', 'dim');
  const matches = [], missing = [], noInfo = [];
  for(let i = 0; i < files.length; i++){
    const f = files[i];
    if(i % 10 === 0) line.lastChild.textContent = 'reading ' + (i + 1) + ' of ' + files.length + '…';
    const hit = byName.get(baseName(f.name));
    if(!hit){ missing.push(f.name); continue; }
    let x = null;
    try{ x = readExif(await f.slice(0, 512 * 1024).arrayBuffer()); }catch(e){}
    const scanner = x && SCANNER_HINTS.test([x.make, x.model, x.software].join(' '));
    if(!x || scanner || (!x.exposure && !x.fnumber && !x.iso && !x.model)){ noInfo.push(f.name); continue; }
    const exif = {};
    if(x.exposure) exif.shutter = fmtShutter(x.exposure);
    if(x.fnumber) exif.f = fmtNum(x.fnumber);
    if(x.iso) exif.iso = x.iso;
    if(x.focal) exif.focal = Number(fmtNum(x.focal));
    matches.push({ cat: hit.cat, id: hit.id, name: hit.p.displayName || hit.p.file, exif,
      camera: prettyCamera(x), lens: prettyLens(x), date: bestDate(hit.p.file, x), had: !!hit.p.exif });
  }
  line.lastChild.textContent = 'read ' + files.length + ' files';
  exifMatches = matches;
  $('#exifSummary').innerHTML = '';
  $('#exifSummary').appendChild(el('span', { text: matches.length + ' matched' + (matches.length ? ' ✓' : '') }));
  if(noInfo.length) $('#exifSummary').appendChild(el('span', { class: 'dim', text: '· ' + noInfo.length + ' had no camera info' }));
  if(missing.length) $('#exifSummary').appendChild(el('span', { class: 'dim', text: '· ' + missing.length + " didn't match any photo on the site" }));
  const lst = $('#exifList');
  lst.innerHTML = '';
  matches.forEach(m => lst.appendChild(el('div', { class: 'item' },
    el('div', { class: 'item-main' },
      el('div', { class: 'item-title', text: m.name + (m.had ? '' : '  (new info)') }),
      el('div', { class: 'item-sub new', text: [m.camera, m.lens, m.exif.shutter, m.exif.f && 'f/' + m.exif.f, m.exif.iso && 'iso ' + m.exif.iso, m.exif.focal && m.exif.focal + 'mm'].filter(Boolean).join(' · ') })))));
  missing.slice(0, 50).forEach(nm => lst.appendChild(el('div', { class: 'item' }, el('div', { class: 'item-main' },
    el('div', { class: 'item-sub miss', text: nm + ' — no photo with this name on the site' })))));
  $('#exifSave').textContent = 'save camera info for ' + matches.length + ' photo' + (matches.length === 1 ? '' : 's');
  $('#exifSave').disabled = !matches.length;
  $('#exifResult').hidden = false;
}

$('#exifSave').addEventListener('click', async () => {
  const items = exifMatches.slice();
  if(!items.length) return;
  const gear = $('#exifReplaceGear').checked;
  try{
    await commit('admin: add camera info to ' + items.length + ' photos', (c) => {
      let n = 0;
      items.forEach(it => {
        const p = (c.photos[it.cat] || []).find(x => x.id === it.id);
        if(!p) return;
        // only camera fields change; descriptions and everything else are left alone
        if(Object.keys(it.exif).length) p.exif = Object.assign({}, p.exif || {}, it.exif);
        if(gear && it.camera) p.camera = it.camera;
        if(gear && it.lens) p.lens = it.lens;
        if(it.date && (!p.date || p.date.slice(0, 10) === it.date.slice(0, 10))) p.date = it.date;
        n++;
      });
      log('updated ' + n + ' photos', 'dim');
    });
    exifMatches = []; $('#exifResult').hidden = true;
  }catch(e){}
});

/* =====================================================================
   videography
   ===================================================================== */
const videoForm = $('#videoForm');
let vid = null; // editor state
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function youtubeId(u){
  u = String(u || '').trim();
  if(/^[\w-]{11}$/.test(u)) return u;
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : '';
}
// the site keeps dates as "Sep 20, 2026"; the form uses 2026-09-20
function toSiteDate(iso){
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? SHORT_MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
}
function fromSiteDate(d){
  const m = String(d || '').match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
  if(!m) return '';
  const mi = SHORT_MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  return mi < 0 ? '' : m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
}
const ytThumb = id => 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
function vidCat(){ return ($('input[name="videoCat"]:checked') || {}).value || 'music'; }
function setVidCat(c){ $$('input[name="videoCat"]').forEach(r => { r.checked = r.value === c; }); }

function loadVideo(v){
  vid = { editing: v ? v.id : null, thumbId: v ? v.thumbId || '' : '', file: null, img: null, removeThumb: false };
  videoForm.reset();
  $('#videoUrl').value = v ? 'https://www.youtube.com/watch?v=' + v.id : '';
  $('#videoTitle').value = v ? v.title : '';
  $('#videoDate').value = v ? fromSiteDate(v.date) : todayISO();
  setVidCat(v ? (v.category || 'music') : 'music');
  $('#videoPinned').checked = !!(v && v.pinned);
  $('#videoDesc').value = v ? v.description || '' : '';
  $('#videoFormTitle').textContent = v ? '~/admin/videography/edit' : '~/admin/videography/new';
  $('#videoSave').textContent = v ? 'save changes' : 'add to videography';
  $('#videoCancel').hidden = !v;
  showVidThumb();
}
function showVidThumb(){
  const img = $('#vthumbPreview');
  const id = youtubeId($('#videoUrl').value);
  let src = '';
  if(vid.file) src = vid.url;
  else if(vid.thumbId && !vid.removeThumb) src = thumbUrl(vid.thumbId, 640);
  else if(id) src = ytThumb(id);
  if(src){ img.src = src; img.hidden = false; $('#vthumbHint').hidden = true; }
  else{ img.removeAttribute('src'); img.hidden = true; $('#vthumbHint').hidden = false; }
  $('#videoThumbRemove').hidden = !(vid.file || (vid.thumbId && !vid.removeThumb));
}
$('#videoCancel').addEventListener('click', () => loadVideo(null));
$('#videoUrl').addEventListener('change', () => { showVidThumb(); if(!$('#videoTitle').value) $('#videoFetch').click(); });
$('#videoThumbRemove').addEventListener('click', () => { vid.file = null; vid.img = null; vid.removeThumb = true; showVidThumb(); });
const vthumbDrop = $('#vthumbDrop'), vthumbInput = $('#videoThumbFile');
function setVidThumb(f){
  if(!f) return;
  if(!isImageFile(f)){ log('thumbnail must be jpeg, png or webp', 'err'); return; }
  vid.file = f; vid.img = null; vid.removeThumb = false; vid.url = URL.createObjectURL(f);
  showVidThumb();
}
vthumbDrop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); vthumbInput.click(); } });
vthumbInput.addEventListener('change', () => { setVidThumb(vthumbInput.files[0]); vthumbInput.value = ''; });
['dragenter', 'dragover'].forEach(t => vthumbDrop.addEventListener(t, e => { e.preventDefault(); vthumbDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => vthumbDrop.addEventListener(t, e => { e.preventDefault(); vthumbDrop.classList.remove('over'); }));
vthumbDrop.addEventListener('drop', e => { if(e.dataTransfer && e.dataTransfer.files[0]) setVidThumb(e.dataTransfer.files[0]); });

$('#videoFetch').addEventListener('click', async () => {
  const id = youtubeId($('#videoUrl').value);
  if(!id){ log("that doesn't look like a YouTube link", 'err'); return; }
  showVidThumb();
  const btn = $('#videoFetch');
  btn.classList.add('is-busy');
  try{
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    const d = await r.json();
    if(d.error || !d.title) throw new Error(d.error || 'no title');
    $('#videoTitle').value = d.title;
    log('title filled in from YouTube — check it reads right', 'ok');
  }catch(e){
    log("couldn't get the title automatically — type it in", 'dim');
  }finally{ btn.classList.remove('is-busy'); }
});

videoForm.addEventListener('submit', async e => {
  e.preventDefault();
  const st = vid;
  const id = youtubeId($('#videoUrl').value);
  const d = { id, title: $('#videoTitle').value.trim(), date: toSiteDate($('#videoDate').value),
    category: vidCat(), pinned: $('#videoPinned').checked, description: $('#videoDesc').value.trim() };
  if(!id){ log("that doesn't look like a YouTube link", 'err'); return; }
  if(!d.title){ log('give the video a title', 'err'); return; }
  if(!d.date){ log('pick a date', 'err'); return; }
  const btn = $('#videoSave');
  btn.classList.add('is-busy');
  try{
    if(st.file && !st.img) st.img = await processImage(st.file, 'vthumb');
    await commit((st.editing ? 'admin: edit video ' : 'admin: add video ') + d.title, (c, m) => {
      c.videos = c.videos || [];
      const files = [];
      const idx = st.editing ? c.videos.findIndex(v => v.id === st.editing) : -1;
      if(st.editing && idx < 0) throw new Error('that video was removed somewhere else');
      if(!st.editing && c.videos.some(v => v.id === id)) throw new Error('that video is already on the site');
      const old = idx >= 0 ? c.videos[idx] : null;
      const entry = { id, title: d.title, date: d.date, category: d.category };
      if(d.description) entry.description = d.description;
      if(d.pinned) entry.pinned = true;
      let thumbId = old ? old.thumbId || '' : '';
      if(st.img){ m[st.img.id] = st.img.entry; files.push(...st.img.files); thumbId = st.img.id; }
      else if(st.removeThumb) thumbId = '';
      if(thumbId) entry.thumbId = thumbId;
      if(old && old.thumbId && old.thumbId !== thumbId){ files.push(...imageFilesFor(old.thumbId, m)); delete m[old.thumbId]; }
      if(idx >= 0) c.videos[idx] = entry; else c.videos.unshift(entry);
      return files;
    });
    if(st.img) localPreviews[st.img.id] = st.img.previewUrl;
    loadVideo(null);
  }catch(err){}
  finally{ btn.classList.remove('is-busy'); }
});

function renderVideos(){
  const list = $('#videoList');
  list.innerHTML = '';
  const vids = (content.videos || []).slice().sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || (Date.parse(y.date) || 0) - (Date.parse(x.date) || 0));
  $('#videoCount').textContent = vids.length + ' videos';
  const label = { music: 'music video', events: 'event', weddings: 'wedding' };
  vids.forEach(v => {
    const img = el('img', { class: 'mini wide', alt: '', loading: 'lazy' });
    img.src = v.thumbId ? thumbUrl(v.thumbId, 640) : ytThumb(v.id);
    list.appendChild(el('div', { class: 'item' }, img,
      el('div', { class: 'item-main' },
        el('div', { class: 'item-title' }, v.title,
          v.category || !v.pinned ? el('span', { class: 'badge sec', text: label[v.category] || v.category || 'no section' }) : null,
          v.pinned ? el('span', { class: 'badge', text: 'demo reel' }) : null),
        el('div', { class: 'item-sub', text: v.date || '' })),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', text: 'open', onclick: () => window.open('https://www.youtube.com/watch?v=' + v.id, '_blank', 'noopener') }),
        el('button', { type: 'button', text: 'edit', onclick: () => { loadVideo(v); videoForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }),
        el('button', { type: 'button', class: 'del', text: 'delete', onclick: async () => {
          if(!confirm('Remove "' + v.title + '" from videography?')) return;
          try{
            await commit('admin: delete video ' + v.title, (c, m) => {
              const target = (c.videos || []).find(x => x.id === v.id);
              c.videos = (c.videos || []).filter(x => x.id !== v.id);
              if(target && target.thumbId){ const f = imageFilesFor(target.thumbId, m); delete m[target.thumbId]; return f; }
              return [];
            });
          }catch(e){}
        } }))));
  });
}
loadVideo(null);

/* =====================================================================
   time well spent
   ===================================================================== */
let editingLink = null;
const linkForm = $('#linkForm');
function linkKindVal(){ return ($('input[name="linkKind"]:checked') || {}).value || 'article'; }
function setLinkKind(k){ $$('input[name="linkKind"]').forEach(r => { r.checked = r.value === k; }); }
function guessKind(url){ return /youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion/i.test(url) ? 'video' : 'article'; }

$('#linkUrl').addEventListener('change', () => { if(!editingLink) setLinkKind(guessKind($('#linkUrl').value)); });
$('#linkFetch').addEventListener('click', async () => {
  const url = $('#linkUrl').value.trim();
  if(!/^https?:\/\//i.test(url)){ log('paste a full link starting with https://', 'err'); return; }
  setLinkKind(guessKind(url));
  const btn = $('#linkFetch');
  btn.classList.add('is-busy');
  try{
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url));
    const d = await r.json();
    if(d.error || !d.title) throw new Error(d.error || 'no title found');
    if(!$('#linkTitle').value) $('#linkTitle').value = d.title;
    if(!$('#linkAuthor').value && d.author_name) $('#linkAuthor').value = d.author_name;
    log('filled in from ' + (d.provider_name || 'the link') + ' — check it reads right', 'ok');
  }catch(e){
    log("couldn't fill this one in automatically (most sites other than YouTube/Vimeo block it) — type the title yourself", 'dim');
  }finally{
    btn.classList.remove('is-busy');
  }
});

function resetLinkForm(){
  editingLink = null;
  linkForm.reset();
  setLinkKind('video');
  $('#linkFormTitle').textContent = '~/admin/time-well-spent/new';
  $('#linkSave').textContent = 'add to time well spent';
  $('#linkCancel').hidden = true;
}
$('#linkCancel').addEventListener('click', resetLinkForm);

linkForm.addEventListener('submit', async e => {
  e.preventDefault();
  const d = {
    kind: linkKindVal(),
    title: $('#linkTitle').value.trim(),
    author: $('#linkAuthor').value.trim(),
    category: $('#linkCategory').value.trim(),
    url: $('#linkUrl').value.trim(),
  };
  if(!/^https?:\/\//i.test(d.url)){ log('the link must start with https://', 'err'); return; }
  if(!d.title){ log('give it a title', 'err'); return; }
  const editing = editingLink;
  try{
    await commit((editing ? 'admin: edit link ' : 'admin: add link ') + d.title, (c) => {
      if(editing){
        const i = c.links.findIndex(l => l.slug === editing);
        if(i < 0) throw new Error('that link was removed somewhere else');
        c.links[i] = Object.assign({ slug: editing }, d);
      }else{
        const slug = uniqueSlug(slugify(d.title), new Set(c.links.map(l => l.slug)));
        c.links.unshift(Object.assign({ slug }, d));
      }
    });
    resetLinkForm();
  }catch(e){}
});

function renderLinks(){
  const list = $('#linkList');
  list.innerHTML = '';
  $('#linkCount').textContent = content.links.length + ' links';
  content.links.forEach(l => {
    list.appendChild(el('div', { class: 'item' },
      el('div', { class: 'item-main' },
        el('div', { class: 'item-title', text: (l.kind === 'video' ? '▷ ' : '▤ ') + l.title }),
        el('div', { class: 'item-sub', text: [l.author, l.category].filter(Boolean).join(' · ') || l.url })),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', text: 'open', onclick: () => window.open(l.url, '_blank', 'noopener') }),
        el('button', { type: 'button', text: 'edit', onclick: () => {
          editingLink = l.slug;
          $('#linkUrl').value = l.url; $('#linkTitle').value = l.title;
          $('#linkAuthor').value = l.author || ''; $('#linkCategory').value = l.category || '';
          setLinkKind(l.kind || 'article');
          $('#linkFormTitle').textContent = '~/admin/time-well-spent/edit';
          $('#linkSave').textContent = 'save changes';
          $('#linkCancel').hidden = false;
          linkForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }),
        el('button', { type: 'button', class: 'del', text: 'delete', onclick: async () => {
          if(!confirm('Remove "' + l.title + '" from time well spent?')) return;
          try{ await commit('admin: delete link ' + l.title, c => { c.links = c.links.filter(x => x.slug !== l.slug); }); }catch(e){}
        } }))));
  });
}

/* =====================================================================
   blog
   ===================================================================== */
const postForm = $('#postForm'), postBody = $('#postBody'), postPreview = $('#postPreview');
let post = null; // editor state
const IMG_REF = /img\/p\/([\w-]+)-\d+\.\w+/g;
function refsIn(text){ const s = new Set(); let m; IMG_REF.lastIndex = 0; while((m = IMG_REF.exec(text || ''))) s.add(m[1]); return s; }
/* attached files: kept in files/ in the repo, linked from the post as [name](files/…) */
const FILE_LIMIT = 25 * 1024 * 1024;
const FILE_OK = /\.(pdf|txt|md|csv|rtf|docx?|xlsx?|pptx?|odt|ods|odp|pages|key|numbers|epub|zip|mp3|wav|m4a|aiff?|flac)$/i;
const FILE_REF = /files\/([\w.-]+)/g;
function fileRefsIn(text){ const s = new Set(); let m; FILE_REF.lastIndex = 0; while((m = FILE_REF.exec(text || ''))) s.add(m[1]); return s; }
function fmtSize(n){ return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
/* files no other post links to, so they can go when this post stops using them */
function unusedFiles(c, names, skipIdx){
  const others = new Set();
  c.blog.forEach((p, i) => { if(i !== skipIdx) fileRefsIn(p.body).forEach(x => others.add(x)); });
  const out = [];
  names.forEach(n => { if(!others.has(n) && c.files[n]){ out.push({ path: 'files/' + n, delete: true }); delete c.files[n]; } });
  return out;
}

function newPostState(p){
  return {
    slug: p ? p.slug : null,
    pending: new Map(),                 // pictures added in this edit, not saved yet
    pendingFiles: new Map(),            // attached files added in this edit, not saved yet
    cover: { id: p ? p.coverId || '' : '', file: null, img: null, remove: false },
    original: p ? JSON.stringify([p.title, p.date, p.body, !!p.draft, p.coverId || '', p.tag || '']) : JSON.stringify(['', todayISO(), '', false, '', '']),
  };
}
function loadPost(p){
  post = newPostState(p);
  $('#postTitle').value = p ? p.title : '';
  $('#postDate').value = p ? (p.date || todayISO()) : todayISO();
  $('#postDraft').checked = !!(p && p.draft);
  $('#postTag').value = p ? p.tag || '' : '';
  postBody.value = p ? p.body || '' : '';
  $('#postFormTitle').textContent = p ? '~/admin/blog/edit' : '~/admin/blog/new';
  $('#postSave').textContent = p ? 'save changes' : 'publish post';
  showCover();
  renderPreview();
  histReset();
}
postDirty = () => post && (post.pending.size > 0 || post.pendingFiles.size > 0 || post.cover.file || post.cover.remove ||
  JSON.stringify([$('#postTitle').value, $('#postDate').value, postBody.value, $('#postDraft').checked, post.cover.id, $('#postTag').value.trim()]) !== post.original);

function showCover(){
  const c = post.cover;
  const has = c.file || (c.id && !c.remove);
  $('#postCoverName').textContent = c.file ? c.file.name : (has ? 'current cover' : 'none');
  $('#postCoverRemove').hidden = !has;
}
$('#postCoverFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  if(!isImageFile(f)){ log('cover must be jpeg, png or webp', 'err'); return; }
  post.cover.file = f; post.cover.img = null; post.cover.remove = false; post.cover.url = URL.createObjectURL(f);
  showCover(); renderPreview();
});
$('#postCoverRemove').addEventListener('click', () => { post.cover.file = null; post.cover.img = null; post.cover.remove = true; showCover(); renderPreview(); });

/* words a reader actually reads (same count as the site) */
function postWords(md){
  const text = String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~-]+/g, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
}
function showPostStats(){
  const w = postWords(postBody.value);
  $('#postStats').textContent = w ? '· ' + w.toLocaleString('en-US') + ' word' + (w === 1 ? '' : 's') + ' · ' + Math.max(1, Math.round(w / 230)) + ' min read' : '';
}

/* ---- share pages: start ----
   Every published post, every photo and every video has a tiny page of its own:
   blog/<slug>/, photo/<id>/, video/<id>/. Share links point there, so link previews
   (iMessage, Instagram, …) show the right title, text and picture; the page then
   opens the item on the site. They're kept in step automatically by commit(). */
const SITE_URL = 'https://elijahhalford.com';
const SITE_OG_IMAGE = SITE_URL + '/img/og-02-01-26.jpg';
const postPagePath = slug => 'blog/' + slug + '/index.html';
const photoPagePath = id => 'photo/' + id + '/index.html';
const videoPagePath = id => 'video/' + id + '/index.html';
function plainText(md){
  return String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~]+/g, '').replace(/\s+/g, ' ').trim();
}
function clip(t, n){ t = String(t || ''); return t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, '') + '…' : t; }
function imageUrl(id, m, want){
  const e = id && m[id];
  if(!e) return '';
  const w = e.w.filter(x => x <= want).pop() || e.w[0];
  return SITE_URL + '/img/p/' + id + '-' + w + '.' + (e.x || 'webp');
}
function sharePageHtml(o){
  const h = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const url = SITE_URL + '/' + o.path, desc = clip(o.desc, 180);
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<!-- written by /admin: a share page; it opens this ' + o.kind + ' on the site -->\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + h(o.title) + ' — Elijah Halford</title>\n' +
    '<meta name="description" content="' + h(desc) + '">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta property="og:type" content="' + o.ogType + '">\n' +
    '<meta property="og:site_name" content="elijah halford">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:title" content="' + h(o.title) + '">\n' +
    '<meta property="og:description" content="' + h(desc) + '">\n' +
    '<meta property="og:image" content="' + h(o.image || SITE_OG_IMAGE) + '">\n' +
    (o.extra || '') +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + h(o.title) + '">\n' +
    '<meta name="twitter:description" content="' + h(desc) + '">\n' +
    '<meta name="twitter:image" content="' + h(o.image || SITE_OG_IMAGE) + '">\n' +
    '<meta http-equiv="refresh" content="0; url=' + o.open + '">\n' +
    '<script>location.replace(' + JSON.stringify(o.open) + ');</script>\n' +
    '<style>body{background:#000;color:#D8D8D2;font:15px/1.6 "IBM Plex Mono",ui-monospace,monospace;padding:40px}a{color:#8FA88A}</style>\n' +
    '</head>\n<body>\n<p>opening <a href="' + o.open + '">' + h(o.title) + '</a>…</p>\n</body>\n</html>\n';
}
function postPageHtml(p, m){
  const h = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return sharePageHtml({ kind: 'post', path: 'blog/' + p.slug + '/', ogType: 'article', title: p.title, desc: plainText(p.body),
    image: imageUrl(p.coverId, m, 1600), open: '/?post=' + encodeURIComponent(p.slug),
    extra: (p.date ? '<meta property="article:published_time" content="' + h(p.date) + '">\n' : '') +
           (p.tag ? '<meta property="article:tag" content="' + h(p.tag) + '">\n' : '') });
}
function photoPageHtml(p, cat, m){
  const name = String(p.displayName || p.file || 'photo').replace(/\.[^.]+$/, '');
  const gear = [p.film ? p.film + (p.format ? ' ' + p.format : '') : '', p.camera, p.lens].filter(Boolean).join(' · ');
  return sharePageHtml({ kind: 'photo', path: 'photo/' + p.id + '/', ogType: 'website', title: name,
    desc: p.description || (cat === 'film' ? 'film photograph' : cat === 'stills' ? 'film still' : 'photograph') + ' by Elijah Halford' + (gear ? ' — ' + gear : ''),
    image: imageUrl(p.id, m, 1600) || 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(p.id) + '&sz=w1600',
    open: '/?photo=' + encodeURIComponent(p.id) });
}
function videoPageHtml(v, m){
  const kind = { music: 'music video', events: 'event film', weddings: 'wedding film' }[v.category] || 'film';
  return sharePageHtml({ kind: 'video', path: 'video/' + v.id + '/', ogType: 'video.other', title: v.title,
    desc: v.description || (v.pinned ? 'demo reel' : kind) + ' by Elijah Halford' + (v.date ? ' · ' + v.date : ''),
    image: imageUrl(v.thumbId, m, 1280) || 'https://img.youtube.com/vi/' + v.id + '/hqdefault.jpg',
    open: '/?video=' + encodeURIComponent(v.id) });
}
/* feed.xml: an RSS feed of the blog, for feed readers */
function feedXml(c){
  const x = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const posts = c.blog.filter(p => p.slug && !p.draft).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const when = d => { const t = Date.parse(String(d || '').slice(0, 10) + 'T12:00:00Z'); return isNaN(t) ? '' : new Date(t).toUTCString(); };
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n' +
    '<title>elijah halford — blog</title>\n<link>' + SITE_URL + '/</link>\n' +
    '<description>Writing by Elijah Halford, filmmaker and photographer in Orlando, Florida.</description>\n' +
    '<language>en</language>\n<atom:link href="' + SITE_URL + '/feed.xml" rel="self" type="application/rss+xml"/>\n' +
    (posts[0] ? '<lastBuildDate>' + when(posts[0].date) + '</lastBuildDate>\n' : '') +
    posts.map(p => { const url = SITE_URL + '/blog/' + p.slug + '/'; return '<item>\n<title>' + x(p.title) + '</title>\n<link>' + url + '</link>\n<guid isPermaLink="true">' + url + '</guid>\n' +
      (when(p.date) ? '<pubDate>' + when(p.date) + '</pubDate>\n' : '') + (p.tag ? '<category>' + x(p.tag) + '</category>\n' : '') +
      '<description>' + x(clip(plainText(p.body), 400)) + '</description>\n</item>\n'; }).join('') +
    '</channel>\n</rss>\n';
}
function sharePages(c, m){
  const out = new Map();
  out.set('feed.xml', feedXml(c));
  c.blog.forEach(p => { if(p.slug && !p.draft) out.set(postPagePath(p.slug), postPageHtml(p, m)); });
  ['film', 'digital', 'stills'].forEach(k => (c.photos[k] || []).forEach(p => { if(p.id) out.set(photoPagePath(p.id), photoPageHtml(p, k, m)); }));
  (c.videos || []).forEach(v => { if(v.id) out.set(videoPagePath(v.id), videoPageHtml(v, m)); });
  return out;
}
/* what to write or delete so the share pages match the content after a save */
function sharePageChanges(c0, m0, c, m){
  const before = sharePages(c0, m0), after = sharePages(c, m), files = [];
  after.forEach((html, path) => { if(before.get(path) !== html) files.push({ path, blob: new Blob([html], { type: 'text/html' }) }); });
  before.forEach((html, path) => { if(!after.has(path)) files.push({ path, delete: true }); });
  return files;
}
/* ---- share pages: end ---- */

function renderPreview(){
  let html = '<h2 style="color:var(--fg);margin-top:0">' + ($('#postTitle').value || 'untitled').replace(/[<>&]/g, '') + '</h2>';
  const c = post.cover;
  if(c.file) html += '<img class="post-img" src="' + c.url + '" alt="">';
  else if(c.id && !c.remove) html += '<img class="post-img" src="' + thumbUrl(c.id, 960) + '" alt="">';
  html += window.renderMarkdown(postBody.value, { imgBase: '../' });
  postPreview.innerHTML = html;
  showPostStats();
  // pictures not on the website yet: show the local copy
  postPreview.querySelectorAll('img.post-img').forEach(img => {
    const m = (img.getAttribute('src') || '').match(/img\/p\/([\w-]+)-\d+\.\w+$/);
    if(!m) return;
    const p = post.pending.get(m[1]);
    if(p) img.src = p.previewUrl;
    else if(localPreviews[m[1]]) img.src = localPreviews[m[1]];
  });
  // attached files not uploaded yet open from this computer
  postPreview.querySelectorAll('a.post-file').forEach(a => {
    const m = (a.getAttribute('href') || '').match(/files\/([\w.-]+)$/);
    const f = m && post.pendingFiles.get(m[1]);
    if(f){ f.url = f.url || URL.createObjectURL(f.blob); a.href = f.url; }
  });
}
let previewTimer = null;
[postBody, $('#postTitle')].forEach(x => x.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }));

/* undo / redo: our own history, so toolbar edits, pictures and files undo too.
   Typing is grouped into steps by short pauses, new lines and pastes. */
const hist = { stack: [], i: 0, timer: null, started: 0 };
const snap = () => ({ v: postBody.value, s: postBody.selectionStart, e: postBody.selectionEnd });
function histButtons(){
  $('#postUndo').disabled = !(hist.i > 0 || hist.timer);
  $('#postRedo').disabled = !(hist.i < hist.stack.length - 1);
}
function histReset(){ clearTimeout(hist.timer); hist.timer = null; hist.stack = [snap()]; hist.i = 0; histButtons(); }
function histPush(){
  clearTimeout(hist.timer); hist.timer = null;
  const cur = hist.stack[hist.i];
  if(cur && cur.v === postBody.value){ cur.s = postBody.selectionStart; cur.e = postBody.selectionEnd; histButtons(); return; }
  hist.stack = hist.stack.slice(0, hist.i + 1);
  hist.stack.push(snap());
  if(hist.stack.length > 300) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  histButtons();
}
function histApply(step){
  if(hist.timer) histPush();
  const j = hist.i + step;
  if(j < 0 || j >= hist.stack.length) return;
  hist.i = j;
  const st = hist.stack[j];
  postBody.value = st.v;
  postBody.focus();
  postBody.setSelectionRange(st.s, st.e);
  renderPreview();
  histButtons();
}
const undo = () => histApply(-1), redo = () => histApply(1);
postBody.addEventListener('input', e => {
  const t = e.inputType || '';
  if(!hist.timer) hist.started = Date.now();
  if(/^(insertFromPaste|insertFromDrop|deleteByCut|insertLineBreak|insertParagraph)$/.test(t) || Date.now() - hist.started > 2000) histPush();
  else { clearTimeout(hist.timer); hist.timer = setTimeout(histPush, 700); histButtons(); }
});
// the browser's own undo (Edit menu, shake to undo) goes through the same history
postBody.addEventListener('beforeinput', e => {
  if(e.inputType === 'historyUndo'){ e.preventDefault(); undo(); }
  else if(e.inputType === 'historyRedo'){ e.preventDefault(); redo(); }
});
postBody.addEventListener('keydown', e => {
  if(!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); }
  else if((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)){ e.preventDefault(); redo(); }
  else if(k === 'b' && !e.shiftKey){ e.preventDefault(); wrapSel('**', '**', 'bold text'); }
  else if(k === 'i' && !e.shiftKey){ e.preventDefault(); wrapSel('*', '*', 'italic text'); }
});
$('#postUndo').addEventListener('click', undo);
$('#postRedo').addEventListener('click', redo);

/* toolbar */
function wrapSel(before, after, placeholder){
  histPush();
  const s = postBody.selectionStart, e = postBody.selectionEnd, v = postBody.value;
  const sel = v.slice(s, e) || placeholder || '';
  postBody.value = v.slice(0, s) + before + sel + after + v.slice(e);
  postBody.focus();
  postBody.setSelectionRange(s + before.length, s + before.length + sel.length);
  renderPreview();
  histPush();
}
function linePrefix(prefix){
  histPush();
  const s = postBody.selectionStart, v = postBody.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  postBody.value = v.slice(0, ls) + prefix + v.slice(ls);
  postBody.focus();
  postBody.setSelectionRange(s + prefix.length, s + prefix.length);
  renderPreview();
  histPush();
}
function insertAtCursor(text){
  histPush();
  const s = postBody.selectionStart, v = postBody.value;
  postBody.value = v.slice(0, s) + text + v.slice(postBody.selectionEnd);
  postBody.focus();
  postBody.setSelectionRange(s + text.length, s + text.length);
  renderPreview();
  histPush();
}
$$('#mdToolbar button').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.md;
  if(k === 'b') wrapSel('**', '**', 'bold text');
  else if(k === 'i') wrapSel('*', '*', 'italic text');
  else if(k === 'h') linePrefix('# ');
  else if(k === 'quote') linePrefix('> ');
  else if(k === 'list') linePrefix('- ');
  else if(k === 'link'){
    const url = prompt('Link address (https://…)');
    if(url && /^https?:\/\//i.test(url.trim())) wrapSel('[', '](' + url.trim() + ')', 'link text');
  }
}));
$('#postImageFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  if(!isImageFile(f)){ log('pictures must be jpeg, png or webp', 'err'); return; }
  const line = log('resizing ' + f.name + '…', 'dim');
  try{
    const img = await processImage(f, 'post');
    post.pending.set(img.id, img);
    const w = img.entry.w[img.entry.w.length - 1];
    insertAtCursor('\n![' + f.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '') + '](img/p/' + img.id + '-' + w + '.' + img.ext + ')\n');
    line.lastChild.textContent = 'picture ready — it uploads when you publish the post';
  }catch(err){ line.className = 'log-line err'; line.lastChild.textContent = 'picture failed: ' + err.message; }
});
$('#postAttachFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  if(!FILE_OK.test(f.name)){ log(f.name + ": that kind of file can't be attached (pdf, documents, spreadsheets, slides, zip and audio are fine)", 'err'); return; }
  if(f.size > FILE_LIMIT){ log(f.name + ' is ' + fmtSize(f.size) + ' — files can be up to ' + fmtSize(FILE_LIMIT) + '. Try compressing it first.', 'err'); return; }
  if(!f.size){ log(f.name + ' is empty', 'err'); return; }
  const ext = f.name.match(/\.([^.]+)$/)[1].toLowerCase();
  const name = slugify(f.name.replace(/\.[^.]+$/, '')).slice(0, 50) + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  post.pendingFiles.set(name, { blob: f, size: f.size, title: f.name });
  const label = f.name.replace(/[\[\]]/g, '');
  insertAtCursor((postBody.selectionStart && postBody.value[postBody.selectionStart - 1] !== '\n' ? ' ' : '') + '[' + label + '](files/' + name + ')');
  log(f.name + ' (' + fmtSize(f.size) + ') ready — it uploads when you publish the post', 'dim');
});

$('#postNew').addEventListener('click', () => {
  if(postDirty() && !confirm('Discard the changes to this post?')) return;
  loadPost(null);
});

postForm.addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#postTitle').value.trim(), date = $('#postDate').value, body = postBody.value;
  if(!title){ log('the post needs a title', 'err'); return; }
  if(!date){ log('the post needs a date', 'err'); return; }
  const st = post;
  const btn = $('#postSave');
  btn.classList.add('is-busy');
  try{
    if(st.cover.file && !st.cover.img) st.cover.img = await processImage(st.cover.file, 'post');
    const used = refsIn(body);
    await commit((st.slug ? 'admin: edit post ' : 'admin: add post ') + title, (c, m) => {
      const files = [];
      // new pictures that are still in the text
      st.pending.forEach((img, id) => { if(used.has(id)){ m[id] = img.entry; files.push(...img.files); } });
      const usedFiles = fileRefsIn(body);
      st.pendingFiles.forEach((f, name) => { if(usedFiles.has(name)){ c.files[name] = { size: f.size, name: f.title }; files.push({ path: 'files/' + name, blob: f.blob }); } });
      const idx = st.slug ? c.blog.findIndex(p => p.slug === st.slug) : -1;
      if(st.slug && idx < 0) throw new Error('that post was removed somewhere else');
      const old = idx >= 0 ? c.blog[idx] : null;
      const entry = { slug: st.slug || uniqueSlug(slugify(title), new Set(c.blog.map(p => p.slug))), title, date, body };
      const tag = $('#postTag').value.trim().replace(/\s+/g, ' ');
      if(tag) entry.tag = tag;
      if($('#postDraft').checked) entry.draft = true;
      let coverId = old ? old.coverId || '' : '';
      if(st.cover.img){ m[st.cover.img.id] = st.cover.img.entry; files.push(...st.cover.img.files); coverId = st.cover.img.id; }
      else if(st.cover.remove) coverId = '';
      if(coverId) entry.coverId = coverId;
      if(old && old.coverId && old.coverId !== coverId){ files.push(...imageFilesFor(old.coverId, m)); delete m[old.coverId]; }
      // pictures taken out of the text that no other post uses
      if(old){
        const others = new Set();
        c.blog.forEach((p, i) => { if(i !== idx){ refsIn(p.body).forEach(x => others.add(x)); if(p.coverId) others.add(p.coverId); } });
        refsIn(old.body).forEach(id => { if(!used.has(id) && !others.has(id) && m[id]){ files.push(...imageFilesFor(id, m)); delete m[id]; } });
        files.push(...unusedFiles(c, [...fileRefsIn(old.body)].filter(n => !usedFiles.has(n)), idx));
      }
      if(idx >= 0) c.blog[idx] = entry; else c.blog.unshift(entry);
      return files;
    });
    st.pending.forEach((img, id) => { localPreviews[id] = img.previewUrl; });
    if(st.cover.img) localPreviews[st.cover.img.id] = st.cover.img.previewUrl;
    const saved = content.blog.find(p => p.title === title && p.date === date) || null;
    loadPost(saved);
  }catch(err){}
  finally{ btn.classList.remove('is-busy'); }
});

function renderPosts(){
  const list = $('#postList');
  list.innerHTML = '';
  const posts = content.blog.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('#postCount').textContent = posts.length + ' posts';
  if(!posts.length) list.appendChild(el('div', { class: 'dim', text: 'no posts yet — write the first one above' }));
  posts.forEach(p => {
    list.appendChild(el('div', { class: 'item' },
      el('div', { class: 'item-main' },
        el('div', { class: 'item-title' }, p.title, p.tag ? el('span', { class: 'badge sec', text: p.tag }) : null, p.draft ? el('span', { class: 'badge', text: 'draft' }) : null),
        el('div', { class: 'item-sub', text: p.date + ' · ' + (p.body || '').replace(/\s+/g, ' ').slice(0, 80) })),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', text: 'edit', onclick: () => {
          if(postDirty() && !confirm('Discard the changes to the post you are writing?')) return;
          loadPost(p);
          $('#postEditorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }),
        el('button', { type: 'button', class: 'del', text: 'delete', onclick: async () => {
          if(!confirm('Delete the post "' + p.title + '"? Its pictures and attached files are deleted too.')) return;
          try{
            await commit('admin: delete post ' + p.title, (c, m) => {
              const target = c.blog.find(x => x.slug === p.slug);
              if(!target) return [];
              c.blog = c.blog.filter(x => x.slug !== p.slug);
              const others = new Set();
              c.blog.forEach(x => { refsIn(x.body).forEach(id => others.add(id)); if(x.coverId) others.add(x.coverId); });
              const mine = refsIn(target.body); if(target.coverId) mine.add(target.coverId);
              const files = [];
              mine.forEach(id => { if(!others.has(id) && m[id]){ files.push(...imageFilesFor(id, m)); delete m[id]; } });
              files.push(...unusedFiles(c, [...fileRefsIn(target.body)], -1));
              return files;
            });
            if(post && post.slug === p.slug) loadPost(null);
          }catch(e){}
        } }))));
  });
}
loadPost(null);

/* =====================================================================
   information: about, contact, equipment
   ===================================================================== */
const PAGES = {
  about: { fields: ['#aboutHeader', '#aboutBody'], label: 'about',
    get: c => [c.pages.about.header || '', c.pages.about.body || ''],
    set: (c, v) => { c.pages.about = { header: v[0], body: v[1] }; } },
  contact: { fields: ['#contactText'], label: 'contact',
    get: c => [c.pages.contact || ''],
    set: (c, v) => { c.pages.contact = v[0]; } },
  equipment: { fields: ['#equipmentText'], label: 'equipment',
    get: c => [c.pages.equipment || ''],
    set: (c, v) => { c.pages.equipment = v[0]; } },
};
const pageSaved = {};   // what's on the site, per page
// tidy what's typed: no spaces at line ends, no blank lines at the very end
const tidy = t => String(t).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
const pageNow = name => PAGES[name].fields.map(f => $(f).value);
const pageDirty = name => pageSaved[name] !== undefined && JSON.stringify(pageNow(name).map(tidy)) !== JSON.stringify(pageSaved[name].map(tidy));
pagesDirty = () => Object.keys(PAGES).some(pageDirty);

function previewPage(name){
  const box = $('#' + name + 'Preview');
  box.innerHTML = '';
  const v = pageNow(name);
  if(name === 'about'){
    box.appendChild(el('img', { class: 'pv-gif', src: '../img/site/about.gif', alt: '' }));
    box.appendChild(el('pre', { text: v[0] }));
    const pre = el('pre');
    const m = v[1].match(/\btie\b/);
    if(m){
      pre.append(v[1].slice(0, m.index), el('span', { class: 'tie', text: m[0], title: 'the hidden colour button' }), v[1].slice(m.index + m[0].length));
    } else pre.textContent = v[1];
    box.appendChild(pre);
  } else if(name === 'contact'){
    // the same links the site makes: emails, @handles (Instagram), youtube.com/…
    const pre = el('pre'), re = /([\w.+-]+@[\w-]+\.[\w.-]+)|(^|\s)(@[\w.]+)|(youtube\.com\/\S+)/gm;
    let last = 0, m;
    while((m = re.exec(v[0]))){
      const t = m[1] || m[3] || m[4], at = m[1] || m[4] ? m.index : m.index + m[2].length;
      pre.append(v[0].slice(last, at), el('span', { class: 'tie', text: t }));
      last = at + t.length;
    }
    pre.append(v[0].slice(last));
    box.appendChild(pre);
  } else box.appendChild(el('pre', { text: v[0] }));
  $('#' + name + 'State').textContent = pageDirty(name) ? 'unsaved changes' : '';
}
function loadPage(name){
  const v = PAGES[name].get(content);
  pageSaved[name] = v;
  PAGES[name].fields.forEach((f, i) => { $(f).value = v[i]; });
  previewPage(name);
}
function renderPages(){
  // never overwrite something being typed; otherwise show what's on the site
  Object.keys(PAGES).forEach(name => { if(!pageDirty(name)) loadPage(name); else previewPage(name); });
}
Object.keys(PAGES).forEach(name => {
  const pg = PAGES[name];
  pg.fields.forEach(f => $(f).addEventListener('input', () => previewPage(name)));
  $('#' + name + 'Revert').addEventListener('click', () => {
    if(pageDirty(name) && !confirm('Undo your changes to ' + pg.label + '?')) return;
    loadPage(name);
  });
  $('#' + name + 'Save').addEventListener('click', async () => {
    const v = pageNow(name).map(tidy);
    if(!v.join('').trim()){ log(pg.label + " can't be empty", 'err'); return; }
    const btn = $('#' + name + 'Save');
    btn.classList.add('is-busy');
    try{
      await commit('admin: edit ' + pg.label, c => { pg.set(c, v); });
      loadPage(name);
    }catch(e){}
    finally{ btn.classList.remove('is-busy'); }
  });
});

/* =====================================================================
   stats: Cloudflare Web Analytics, read through the stats Worker
   ===================================================================== */
let statsDays = 7, statsReq = 0;
function renderStatsSetup(){
  const a = content.analytics || {};
  [['#statsBeacon', a.beacon], ['#statsWorker', a.worker]].forEach(([id, v]) => { if(document.activeElement !== $(id)) $(id).value = v || ''; });
  $('#statsSetupState').textContent = a.beacon && a.worker ? 'set up ✓' : a.beacon ? 'counting visits · Worker not added yet' : 'not set up yet';
  if(!$('[data-view="home"]').hidden) loadStats();
}
$$('#statsRange button').forEach(b => b.addEventListener('click', () => {
  statsDays = +b.dataset.days;
  $$('#statsRange button').forEach(x => x.classList.toggle('on', x === b));
  loadStats();
}));
$('#statsBeaconSave').addEventListener('click', async () => {
  const t = $('#statsBeacon').value.trim().replace(/^.*"token"\s*:\s*"([^"]+)".*$/s, '$1');
  if(t && !/^[0-9a-f]{32}$/i.test(t)){ log("that doesn't look like a Web Analytics token (32 letters and numbers)", 'err'); return; }
  try{ await commit(t ? 'admin: turn on visitor stats' : 'admin: turn off visitor stats', c => { if(t) c.analytics.beacon = t; else delete c.analytics.beacon; }); }catch(e){}
});
$('#statsCopyWorker').addEventListener('click', async () => {
  const st = $('#statsCopyState');
  try{
    const code = await readText('tools/stats-worker.js');
    await navigator.clipboard.writeText(code);
    st.textContent = 'copied ✓ (' + code.split('\n').length + ' lines) — now paste it into the Worker';
  }catch(e){ st.textContent = "couldn't copy: " + e.message; }
});
$('#statsWorkerSave').addEventListener('click', async () => {
  const u = $('#statsWorker').value.trim().replace(/\/+$/, '');
  if(u && !/^https:\/\/[\w.-]+(\/[\w./-]*)?$/i.test(u)){ log('the Worker address should look like https://name.yourname.workers.dev', 'err'); return; }
  try{ await commit('admin: set stats Worker address', c => { if(u) c.analytics.worker = u; else delete c.analytics.worker; }); }catch(e){}
});

const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const dayLabel = d => { const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/); return m ? MON[+m[1] - 1] + ' ' + (+m[2]) : d; };
const fmtN = n => Number(n || 0).toLocaleString('en-US');
async function loadStats(){
  const body = $('#statsBody');
  const a = (content && content.analytics) || {};
  if(!a.worker){
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'dim', text: a.beacon ? 'The site is counting visits. Add the stats Worker in connect to see the numbers here.' : 'No stats yet: set them up in connect → stats.' }));
    return;
  }
  const mine = ++statsReq;
  body.innerHTML = '';
  body.appendChild(el('p', { class: 'dim', text: 'loading the last ' + statsDays + ' days…' }));
  let d;
  try{
    const r = await fetch(a.worker + '/?days=' + statsDays, { headers: { Authorization: 'Bearer ' + token } });
    d = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(d.error || ('the Worker said ' + r.status));
  }catch(e){
    if(mine !== statsReq) return;
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'err', text: "couldn't load stats: " + e.message }));
    return;
  }
  if(mine !== statsReq) return;
  renderStats(body, d);
}
function renderStats(body, d){
  body.innerHTML = '';
  const t = d.total || {};
  body.appendChild(el('div', { class: 'stat-tiles' },
    el('div', { class: 'stat-tile' }, el('div', { class: 'n', text: fmtN(t.visits) }), el('div', { class: 'l', text: 'visits' })),
    el('div', { class: 'stat-tile' }, el('div', { class: 'n', text: fmtN(t.views) }), el('div', { class: 'l', text: 'page views' })),
    el('div', { class: 'stat-tile' }, el('div', { class: 'n', text: t.visits ? (t.views / t.visits).toFixed(1) : '–' }), el('div', { class: 'l', text: 'views per visit' }))));
  if(!t.views){ body.appendChild(el('p', { class: 'dim', text: 'No visits recorded in this range yet. Cloudflare can take a few minutes to show new ones.' })); return; }

  // one bar per day, days without visits included
  const byDate = new Map((d.byDay || []).map(r => [String(r.date).slice(0, 10), r]));
  const days = [];
  for(let ms = Date.parse(String(d.since).slice(0, 10) + 'T00:00:00Z'), end = Date.parse(String(d.until).slice(0, 10) + 'T00:00:00Z'); ms <= end; ms += 86400000){
    const key = new Date(ms).toISOString().slice(0, 10);
    const r = byDate.get(key) || {};
    days.push({ date: key, views: r.views || 0, visits: r.visits || 0 });
  }
  // drawn at the panel's real width, so text isn't stretched; thin bars, 2px apart
  const W = Math.max(280, Math.round(body.clientWidth || 600)), H = 150, top = 16, bottom = 20, max = Math.max(1, ...days.map(x => x.views));
  const slot = W / days.length, bw = Math.max(1, Math.min(28, slot - 2));
  const svgNS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(svgNS, tag); for(const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const svg = mk('svg', { class: 'stat-chart', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
    'aria-label': 'page views per day: ' + days.map(x => dayLabel(x.date) + ' ' + x.views).join(', ') });
  const tip = el('div', { class: 'stat-tip', hidden: true });
  days.forEach((x, i) => {
    const h = x.views ? Math.max(2, (H - top - bottom) * x.views / max) : 0;
    const g = mk('g', { class: 'day', tabindex: '0' });
    g.appendChild(mk('rect', { x: i * slot, y: top, width: slot, height: H - top - bottom, fill: 'transparent' }));   // easy hover target
    if(h) g.appendChild(mk('rect', { class: 'bar', x: i * slot + (slot - bw) / 2, y: H - bottom - h, width: bw, height: h, rx: Math.min(2, bw / 2) }));
    const show = e => {
      tip.textContent = dayLabel(x.date) + ' · ' + fmtN(x.views) + ' views · ' + fmtN(x.visits) + ' visits';
      tip.hidden = false;
      const r = g.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 220, Math.max(8, r.left + r.width / 2 - 90)) + 'px';
      tip.style.top = (r.top - 4 + (H - bottom - h) / H * r.height - 30) + 'px';
    };
    g.addEventListener('mouseenter', show); g.addEventListener('focus', show);
    g.addEventListener('mouseleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
    svg.appendChild(g);
  });
  svg.appendChild(mk('line', { class: 'base', x1: 0, x2: W, y1: H - bottom + 0.5, y2: H - bottom + 0.5 }));
  const lbl = (x, anchor, text) => { const n = mk('text', { x, y: H - 4, 'text-anchor': anchor }); n.textContent = text; svg.appendChild(n); };
  lbl(0, 'start', dayLabel(days[0].date)); lbl(W, 'end', dayLabel(days[days.length - 1].date));
  const mx = mk('text', { x: 0, y: 10 }); mx.textContent = 'most in a day: ' + fmtN(max) + ' views'; svg.appendChild(mx);
  body.appendChild(el('div', {}, svg, tip));

  const list = (title, rows, key, nice) => {
    const box = el('div', { class: 'stat-list' }, el('h3', { text: title }));
    const top = Math.max(1, ...rows.map(r => r.views));
    if(!rows.length) box.appendChild(el('div', { class: 'dim', text: 'nothing yet' }));
    rows.forEach(r => {
      const track = el('div', { class: 'track' }, el('i'));
      track.firstChild.style.width = (100 * r.views / top).toFixed(1) + '%';
      box.appendChild(el('div', { class: 'stat-row' }, el('span', { class: 'k', text: nice(r[key]), title: nice(r[key]) }), el('span', { class: 'v', text: fmtN(r.views) }), track));
    });
    return box;
  };
  const path = p => !p || p === '/' ? 'the site (main page)' : p.replace(/^\/(blog|photo|video)\//, '$1/').replace(/\/$/, '');
  body.appendChild(el('div', { class: 'stat-lists' },
    list('where visitors came from', d.referrers || [], 'host', h => h || 'direct (typed in, or an app)'),
    list('pages', d.pages || [], 'path', path),
    list('countries', d.countries || [], 'country', c => c || 'unknown'),
    list('devices', d.devices || [], 'device', x => x || 'unknown'),
    list('browsers', d.browsers || [], 'browser', x => x || 'unknown')));
  body.appendChild(el('p', { class: 'dim', text: 'Counts are page views. The site is one page, so most views show as the main page.' }));
}

/* =====================================================================
   music: only asks for title, artist and cover; looks the rest up
   ===================================================================== */
const albumForm = $('#albumForm');
let album = null; // editor state
const MB = 'https://musicbrainz.org/ws/2/';
let mbLast = 0;
async function mb(path){
  // MusicBrainz allows about one request a second
  const wait = 1100 - (Date.now() - mbLast);
  if(wait > 0) await sleep(wait);
  mbLast = Date.now();
  const r = await fetch(MB + path + (path.includes('?') ? '&' : '?') + 'fmt=json', { headers: { 'Accept': 'application/json' } });
  if(!r.ok) throw new Error('MusicBrainz said ' + r.status);
  return r.json();
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function niceDate(d){
  const m = String(d || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if(!m) return '';
  if(m[3]) return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  if(m[2]) return MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  return '';
}
function mmss(ms){
  if(!ms) return '';
  const t = Math.round(ms / 1000), h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? (h * 60 + mi) + ':' + String(s).padStart(2, '0') : mi + ':' + String(s).padStart(2, '0');
}
function mbType(rg){
  const sec = (rg['secondary-types'] || []).map(x => x.toLowerCase());
  if(sec.includes('compilation')) return 'compilation';
  if(sec.includes('soundtrack')) return 'soundtrack';
  if(sec.includes('mixtape/street')) return 'mixtape';
  const p = (rg['primary-type'] || 'album').toLowerCase();
  return ['album', 'ep', 'single'].includes(p) ? p : 'album';
}
const q = s => String(s).replace(/["\\]/g, ' ').trim();

function newAlbumState(a){
  return { slug: a ? a.slug : null, coverFile: null, coverImg: null, coverId: a ? a.coverId || '' : '', coverUrl: a ? a.cover || '' : '',
    mbid: a ? a.mbid || '' : '', matches: [], lookedUp: a ? (a.title + '|' + a.artist) : '' };
}
function loadAlbum(a){
  album = newAlbumState(a);
  albumForm.reset();
  $('#albumTitle').value = a ? a.title : '';
  $('#albumArtist').value = a ? a.artist : '';
  $('#albumYear').value = a ? a.year || '' : '';
  $('#albumReleased').value = a ? a.released || '' : '';
  $('#albumLength').value = a ? a.length || '' : '';
  $('#albumType').value = a ? (a.releaseType || 'album') : 'album';
  $('#albumGenre').value = a ? a.category || '' : '';
  $('#albumSpotify').value = a ? a.spotify || '' : '';
  $('#albumMatches').hidden = true;
  const note = $('#albumFoundNote');
  note.className = 'dim small';
  note.textContent = a ? 'editing — change anything, or look the details up again.' : 'year, release date, type, genre and length are found automatically from MusicBrainz. Check them before saving.';
  $('#albumFormTitle').textContent = a ? '~/admin/music/edit' : '~/admin/music/new';
  $('#albumSave').textContent = a ? 'save changes' : 'add to music';
  $('#albumCancel').hidden = !a;
  showCoverPreview(a ? (a.coverId ? thumbUrl(a.coverId, 600) : a.cover || '') : '');
}
function showCoverPreview(src){
  const img = $('#coverPreview');
  if(src){ img.src = src; img.hidden = false; $('#coverHint').hidden = true; }
  else{ img.removeAttribute('src'); img.hidden = true; $('#coverHint').hidden = false; }
}
$('#albumCancel').addEventListener('click', () => loadAlbum(null));

const coverDrop = $('#coverDrop'), coverInput = $('#albumCoverFile');
coverDrop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); coverInput.click(); } });
function setCoverFile(f){
  if(!f) return;
  if(!isImageFile(f)){ log('cover must be jpeg, png or webp', 'err'); return; }
  album.coverFile = f; album.coverImg = null;
  showCoverPreview(URL.createObjectURL(f));
}
coverInput.addEventListener('change', () => { setCoverFile(coverInput.files[0]); coverInput.value = ''; });
['dragenter', 'dragover'].forEach(t => coverDrop.addEventListener(t, e => { e.preventDefault(); coverDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => coverDrop.addEventListener(t, e => { e.preventDefault(); coverDrop.classList.remove('over'); }));
coverDrop.addEventListener('drop', e => { if(e.dataTransfer && e.dataTransfer.files[0]) setCoverFile(e.dataTransfer.files[0]); });

async function fillFromGroup(rg){
  const note = $('#albumFoundNote');
  album.mbid = rg.id;
  $('#albumYear').value = (rg['first-release-date'] || '').slice(0, 4);
  $('#albumReleased').value = niceDate(rg['first-release-date']);
  $('#albumType').value = mbType(rg);
  note.className = 'dim small';
  note.textContent = 'found "' + rg.title + '" by ' + ((rg['artist-credit'] || []).map(a => a.name + (a.joinphrase || '')).join('') || '?') + ' — getting genre and length…';
  let genre = '', length = '';
  try{
    const full = await mb('release-group/' + rg.id + '?inc=genres+tags');
    const pickNames = arr => (arr || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3).map(g => g.name.toLowerCase());
    genre = pickNames(full.genres).join(' / ') || pickNames(full.tags).join(' / ');
  }catch(e){}
  try{
    const rel = await mb('release?release-group=' + rg.id + '&inc=recordings&limit=10');
    const releases = (rel.releases || []).filter(r => (r.media || []).length)
      .sort((a, b) => (a.status === 'Official' ? 0 : 1) - (b.status === 'Official' ? 0 : 1) || String(a.date || '9').localeCompare(String(b.date || '9')));
    for(const r of releases){
      const tracks = r.media.flatMap(md => md.tracks || []);
      const total = tracks.reduce((s, t) => s + (t.length || 0), 0);
      if(tracks.length && tracks.every(t => t.length)){ length = mmss(total); break; }
    }
  }catch(e){}
  if(genre) $('#albumGenre').value = genre;
  if(length) $('#albumLength').value = length;
  note.className = 'small ok';
  note.textContent = 'found on MusicBrainz ✓ — ' + [$('#albumYear').value, $('#albumType').value, genre || 'no genre listed', length].filter(Boolean).join(' · ') + '. Check before saving.';
}

async function lookupAlbum(){
  const title = $('#albumTitle').value.trim(), artist = $('#albumArtist').value.trim();
  if(!title || !artist){ log('type the album and the artist first', 'err'); return; }
  album.lookedUp = title + '|' + artist;
  const note = $('#albumFoundNote'), btn = $('#albumLookup');
  btn.classList.add('is-busy');
  note.className = 'dim small'; note.textContent = 'looking it up…';
  try{
    const res = await mb('release-group/?limit=6&query=' + encodeURIComponent('releasegroup:"' + q(title) + '" AND artist:"' + q(artist) + '"'));
    let groups = res['release-groups'] || [];
    if(!groups.length){
      const loose = await mb('release-group/?limit=6&query=' + encodeURIComponent(q(title) + ' ' + q(artist)));
      groups = loose['release-groups'] || [];
    }
    album.matches = groups;
    if(!groups.length) throw new Error('nothing found');
    const sel = $('#albumMatches');
    sel.innerHTML = '';
    groups.forEach((g, i) => sel.appendChild(el('option', { value: i, text: g.title + ' — ' + ((g['artist-credit'] || [])[0] || {}).name + ' (' + ((g['first-release-date'] || '????').slice(0, 4)) + ', ' + (g['primary-type'] || '?').toLowerCase() + ')' })));
    sel.hidden = groups.length < 2;
    await fillFromGroup(groups[0]);
  }catch(e){
    note.className = 'small err';
    note.textContent = "couldn't find it on MusicBrainz (" + e.message + ") — fill in the year and genre yourself.";
  }finally{
    btn.classList.remove('is-busy');
  }
}
$('#albumLookup').addEventListener('click', lookupAlbum);
$('#albumMatches').addEventListener('change', e => { const g = album.matches[Number(e.target.value)]; if(g) fillFromGroup(g); });
// look it up on its own once both names are in
['#albumTitle', '#albumArtist'].forEach(s => $(s).addEventListener('change', () => {
  const t = $('#albumTitle').value.trim(), a = $('#albumArtist').value.trim();
  if(t && a && album.lookedUp !== t + '|' + a && !album.slug) lookupAlbum();
}));

albumForm.addEventListener('submit', async e => {
  e.preventDefault();
  const st = album;
  const d = {
    title: $('#albumTitle').value.trim(), artist: $('#albumArtist').value.trim(),
    year: $('#albumYear').value.trim(), category: $('#albumGenre').value.trim(),
    releaseType: $('#albumType').value, released: $('#albumReleased').value.trim(),
    length: $('#albumLength').value.trim(), spotify: $('#albumSpotify').value.trim(),
  };
  if(!d.title || !d.artist){ log('album and artist are needed', 'err'); return; }
  if(d.spotify && !/^https:\/\//i.test(d.spotify)){ log('the spotify link must start with https://', 'err'); return; }
  const useMb = $('#albumUseMbCover').checked && st.mbid;
  if(!st.coverFile && !st.coverId && !st.coverUrl && !useMb){
    if(!confirm('No cover art — save anyway? (a coloured placeholder is shown instead)')) return;
  }
  const btn = $('#albumSave');
  btn.classList.add('is-busy');
  try{
    if(st.coverFile && !st.coverImg) st.coverImg = await processImage(st.coverFile, 'cover');
    await commit((st.slug ? 'admin: edit album ' : 'admin: add album ') + d.title + ' — ' + d.artist, (c, m) => {
      const files = [];
      const idx = st.slug ? c.music.findIndex(a => a.slug === st.slug) : -1;
      if(st.slug && idx < 0) throw new Error('that album was removed somewhere else');
      const old = idx >= 0 ? c.music[idx] : null;
      const entry = { slug: st.slug || uniqueSlug(slugify(d.title + '-' + d.artist), new Set(c.music.map(a => a.slug))), title: d.title, artist: d.artist };
      if(d.year) entry.year = /^\d{4}$/.test(d.year) ? Number(d.year) : d.year;
      if(d.category) entry.category = d.category;
      if(d.releaseType) entry.releaseType = d.releaseType;
      if(d.released) entry.released = d.released;
      if(d.length) entry.length = d.length;
      if(st.coverImg){ m[st.coverImg.id] = st.coverImg.entry; files.push(...st.coverImg.files); entry.coverId = st.coverImg.id; }
      else if(old && old.coverId) entry.coverId = old.coverId;
      else if(old && old.cover) entry.cover = old.cover;
      else if(useMb) entry.cover = 'https://coverartarchive.org/release-group/' + st.mbid + '/front-500';
      if(old && old.coverId && entry.coverId !== old.coverId){ files.push(...imageFilesFor(old.coverId, m)); delete m[old.coverId]; }
      if(d.spotify) entry.spotify = d.spotify;
      if(st.mbid) entry.mbid = st.mbid;
      if(idx >= 0) c.music[idx] = entry; else c.music.push(entry);
      return files;
    });
    if(st.coverImg) localPreviews[st.coverImg.id] = st.coverImg.previewUrl;
    loadAlbum(null);
  }catch(err){}
  finally{ btn.classList.remove('is-busy'); }
});

function renderAlbums(){
  const list = $('#albumList');
  list.innerHTML = '';
  const albums = content.music.slice().sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || String(a.title).localeCompare(String(b.title)));
  $('#albumCount').textContent = albums.length + ' releases';
  albums.forEach(a => {
    const img = el('img', { class: 'mini', alt: '', loading: 'lazy' });
    const src = a.coverId ? thumbUrl(a.coverId, 300) : a.cover;
    if(src) img.src = src;
    list.appendChild(el('div', { class: 'item' }, img,
      el('div', { class: 'item-main' },
        el('div', { class: 'item-title', text: a.title }),
        el('div', { class: 'item-sub', text: [a.artist, a.year, a.category].filter(Boolean).join(' · ') })),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', text: 'edit', onclick: () => { loadAlbum(a); albumForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }),
        el('button', { type: 'button', class: 'del', text: 'delete', onclick: async () => {
          if(!confirm('Remove "' + a.title + '" by ' + a.artist + ' from music?')) return;
          try{
            await commit('admin: delete album ' + a.title, (c, m) => {
              const target = c.music.find(x => x.slug === a.slug);
              c.music = c.music.filter(x => x.slug !== a.slug);
              if(target && target.coverId){ const f = imageFilesFor(target.coverId, m); delete m[target.coverId]; return f; }
              return [];
            });
          }catch(e){}
        } }))));
  });
}
loadAlbum(null);



/* =====================================================================
   start
   ===================================================================== */
updateConn();
if(token){ connect(); } else { showTab('connect'); log('paste a GitHub access key to start', 'dim'); }

})();
