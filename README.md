# elijahhalford.com

Terminal-style portfolio, hosted on GitHub Pages.

## Updating the site

Go to **elijahhalford.com/admin** and connect with a GitHub fine-grained access key
(only this repository · Contents: read & write · optionally Actions: read).

- **photos** – drop JPEG/PNG files; they're resized for the web in your browser, camera
  settings are read from the file, film scans get film stock + format boxes. The
  **camera info** tab copies settings from originals onto photos already on the site.
- **time well spent** – add/edit/delete links (YouTube/Vimeo titles fill in automatically).
- **videography** – paste a YouTube link, pick a section, optionally add a thumbnail.
- **blog** – write posts with a live preview, pictures, attached files (PDFs, documents,
  audio… up to 25 MB each, stored in `files/`) and an optional cover; drafts stay hidden.
  Ctrl/⌘ Z undoes, Ctrl/⌘ Shift Z or Ctrl Y redoes, Ctrl/⌘ B / I for bold / italic.
- **about.txt / contact.txt / equipment.txt** – edit the text of those files, with a live preview.
- **stats** – visitor numbers from Cloudflare Web Analytics (set-up below).
- **↶ undo last save** (in the activity bar) – puts every file back the way it was before
  the most recent admin save. Press it again to redo.
- **music** – type the album and artist, add cover art; year, release date, type, genre and
  length are looked up on MusicBrainz.

Every save is a single commit; GitHub Pages republishes the site a minute or two later.
Each save also keeps the share pages (`blog/<slug>/`, `photo/<id>/`, `video/<id>/`) and the
blog feed (`feed.xml`) in step with the content.

## Visitor stats (Cloudflare Web Analytics)

Already set up (October 2026). These are the steps in case it ever needs redoing,
e.g. a new Cloudflare account, or the Worker or its API token was deleted.

### How it fits together

```
visitor's browser ──(counts the visit)──▶ Cloudflare Web Analytics
/admin → stats ──(your GitHub key)──▶ stats Worker ──(Cloudflare API token)──▶ Cloudflare Web Analytics
```

Cloudflare doesn't let a web page read the stats directly, so a small free Cloudflare
**Worker** (`tools/stats-worker.js`) fetches them for the admin. The Worker only answers
when the request carries a GitHub key that can edit this repository, so only you see the numbers.

### Four different values. Don't mix them up

| What | Looks like | Where it comes from | Where it goes |
|---|---|---|---|
| **Web Analytics token** | 32 letters/numbers | Web Analytics → the site → the JS snippet, inside `data-cf-beacon='{"token": "…"}'` | /admin → stats → **step 1** |
| **API token** | ~40 characters, shown **only once** | My Profile → API Tokens → Create Token (below) | Worker setting `CF_API_TOKEN` (type **Secret**) |
| **Account ID** | 32 letters/numbers | The string right after `dash.cloudflare.com/` in the address bar, or Workers & Pages → right-hand column | Worker setting `CF_ACCOUNT_ID` (type Text) |
| **Site tag** | 32 letters/numbers | Web Analytics → click the site → the address bar shows `siteTag~in=<this>`. Copy **only** up to the `&`, not `&excludeBots=Yes` | Worker setting `CF_SITE_TAG` (type Text) |

The Web Analytics token and the site tag look alike but are **not** the same thing.

### Steps

1. **Start counting visits.** Cloudflare dashboard → *Analytics & Logs → Web Analytics → Add a site* →
   `elijahhalford.com` → choose the JavaScript snippet. Copy the **Web Analytics token** out of the
   snippet → /admin → stats → step 1 → *save to site*.
2. **Make an API token.** Profile icon → *My Profile → API Tokens → Create Token* → *Create Custom Token*
   (*Get started*). Name: anything (e.g. `elijahhalford stats`; it's only a label). Permissions: one row,
   **Account · Account Analytics · Read**. Account Resources: your account. → *Continue to summary* →
   *Create Token* → **copy the token now**. It's never shown again (make a new one if lost).
   Don't use the *Global API Key* on the same page. It won't work.
3. **Create the Worker.** *Workers & Pages → Create → Worker* → name `elijahhalford-stats` → *Deploy* →
   *Edit code* → select everything in the editor and paste the **contents** of `tools/stats-worker.js`
   (/admin → stats → *copy the Worker code* puts them on your clipboard). Don't paste the *file name*:
   that gives `ReferenceError: tools is not defined`. → *Deploy*.
4. **Give the Worker its settings.** Worker → *Settings → Variables and Secrets* → add:
   - `CF_API_TOKEN` · type **Secret** · value = the API token from step 2 (no spaces or quotes;
     "Secret" just hides it, so there's no password to invent)
   - `CF_ACCOUNT_ID` · type Text · value = Account ID
   - `CF_SITE_TAG` · type Text · value = site tag

   → *Deploy*. Keep the `workers.dev` address **enabled and public**, and don't put Cloudflare Access
   (a login) in front of it, or the admin can't reach it. It's still private: it only answers your GitHub key.
5. **Connect the admin.** Copy the Worker's address (`https://elijahhalford-stats.marvelelijah.workers.dev`)
   → /admin → stats → step 2 → *save*. Reload the stats tab.

### If something's off

| You see | It means | Fix |
|---|---|---|
| Opening the Worker's address shows `{"error":"no access key sent"}` | **Working.** Browsers don't send your key; only the admin does | Nothing. Check stats in /admin |
| `{"error":"the Worker is missing CF_API_TOKEN, CF_ACCOUNT_ID or CF_SITE_TAG"}` | A setting is missing or misspelled | Check the three names exactly, *Deploy* again |
| The Worker's address shows "Hello World!" | The code wasn't saved | Paste the code again (step 3), *Deploy* |
| `Uncaught ReferenceError: tools is not defined` when deploying | The file *name* was pasted, not its contents | Step 3 |
| *couldn't load stats: Cloudflare said: Authentication failed* | `CF_API_TOKEN` isn't a valid API token (e.g. the Web Analytics token or Global API Key was used) | New token (step 2), paste into `CF_API_TOKEN`, *Deploy* |
| *Cloudflare said: … not authorized …* | The token works but lacks the permission | Token needs **Account · Account Analytics · Read** for your account |
| *that access key cannot edit …* | The admin's GitHub key expired or changed | Reconnect in /admin → connect with a current key |
| "No visits recorded in this range yet" | Set up fine, just no data yet | New visits take a few minutes to appear |

Notes: the admin's numbers include bots (the Cloudflare dashboard hides them by default), so they can
run a little higher. The site is one page, so most views show as "the site (main page)". If the API
token is ever rolled or deleted, only step 2 and the `CF_API_TOKEN` setting need redoing.

## Where things live

- `index.html` – the site
- `content/content.js` – all photo info, links, music and blog posts (edited by /admin)
- `img/p/` + `img/manifest.js` – web-sized images and their sizes / blur previews
- `files/` – files attached to blog posts
- `blog/<slug>/`, `photo/<id>/`, `video/<id>/` – share pages (link previews), written by /admin
- `feed.xml` – the blog's RSS feed, written by /admin
- `404.html` – the "no such file or directory" page
- `tools/stats-worker.js` – the Cloudflare Worker behind /admin → stats
- `admin/` – the admin page
- `tools/optimize_images.py` – batch-convert a folder of originals (for bulk imports)
