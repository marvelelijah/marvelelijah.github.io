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
- **about.txt / equipment.txt** – edit the text of those two files, with a live preview.
- **music** – type the album and artist, add cover art; year, release date, type, genre and
  length are looked up on MusicBrainz.

Every save is a single commit; GitHub Pages republishes the site a minute or two later.

## Where things live

- `index.html` – the site
- `content/content.js` – all photo info, links, music and blog posts (edited by /admin)
- `img/p/` + `img/manifest.js` – web-sized images and their sizes / blur previews
- `files/` – files attached to blog posts
- `blog/<slug>/index.html` – each published post's share page (link previews), written by /admin
- `admin/` – the admin page
- `tools/optimize_images.py` – batch-convert a folder of originals (for bulk imports)
