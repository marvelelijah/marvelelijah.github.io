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

## Visitor stats (Cloudflare Web Analytics), once

1. **Count visits.** Cloudflare dashboard → *Analytics & Logs → Web Analytics → Add a site* →
   `elijahhalford.com` → pick the JavaScript snippet. Copy the token from
   `data-cf-beacon='{"token": "…"}'` and paste it into /admin → stats → step 1 → *save to site*.
2. **Let the admin read them.** The analytics API can't be called from a web page, so a free
   Worker passes the numbers along (`tools/stats-worker.js`; it only answers your GitHub key).
   - *My Profile → API Tokens → Create Token → Custom*: permission **Account · Account Analytics · Read**,
     your account → create, copy it.
   - Note your **Account ID** (account home page, right-hand column) and the site's **site tag**
     (Web Analytics → the site → *Manage site*; it's also the `siteTag` in that page's address).
   - *Workers & Pages → Create → Worker* → name it `elijahhalford-stats` → *Deploy* → *Edit code* →
     select everything in the editor and paste the **contents** of `tools/stats-worker.js` over it
     (/admin → stats → *copy the Worker code* puts it on your clipboard) → *Deploy*.
   - Worker → *Settings → Variables and Secrets*: add `CF_API_TOKEN` (type **Secret**),
     `CF_ACCOUNT_ID` and `CF_SITE_TAG` (type Text) → *Deploy*.
   - Copy the Worker's address (`https://elijahhalford-stats.<you>.workers.dev`) into /admin → stats →
     step 2 → *save*.

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
