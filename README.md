# elijahhalford.com

Terminal-style portfolio, hosted on GitHub Pages.

## Updating the site

Go to **elijahhalford.com/admin** and connect with a GitHub fine-grained access key
(only this repository · Contents: read & write · optionally Actions: read).

- **photos** – drop JPEG/PNG files; they're resized for the web in your browser, camera
  settings are read from the file, film scans get film stock + format boxes.
- **time well spent** – add/edit/delete links (YouTube/Vimeo titles fill in automatically).
- **blog** – write posts with a live preview, pictures and an optional cover; drafts stay hidden.
- **music** – type the album and artist, add cover art; year, release date, type, genre and
  length are looked up on MusicBrainz.

Every save is a single commit; GitHub Pages republishes the site a minute or two later.

## Where things live

- `index.html` – the site
- `content/content.js` – all photo info, links, music and blog posts (edited by /admin)
- `img/p/` + `img/manifest.js` – web-sized images and their sizes / blur previews
- `admin/` – the admin page
- `tools/optimize_images.py` – batch-convert a folder of originals (for bulk imports)
