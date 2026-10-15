/* Tiny, safe markdown for blog posts. Shared by the site and /admin (live preview).
   Supports: # / ## / ### headings, paragraphs, line breaks, > quotes, - lists,
   **bold**, *italic*, `code`, [links](https://…), ![images](img/…), [files](files/…), --- rules.
   Everything is HTML-escaped first, so a post can never inject markup or script. */
(function(){
  function esc(s){
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // only web links, mail links and the site's own files are allowed
  function safeUrl(u){
    u = String(u || '').trim();
    if(/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
    if(/^(\.\.\/)?(img|content|files)\/[\w\-./]+$/.test(u) && !/\.\./.test(u.replace(/^\.\.\//, ''))) return u.replace(/^\.\.\//, '');
    return '';
  }
  function inline(t, opts){
    // t is already escaped
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      const u = safeUrl(src.replace(/&amp;/g, '&'));
      return u ? '<img class="post-img" src="' + esc(opts.imgBase + u) + '" alt="' + alt + '" loading="lazy">' : '';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      const u = safeUrl(href.replace(/&amp;/g, '&'));
      if(!u) return text;
      const ext = /^https?:/i.test(u), file = /^files\//.test(u);
      return '<a href="' + esc(ext ? u : opts.imgBase + u) + '"' + (file ? ' class="post-file"' : '') +
        (ext || file ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + text + '</a>';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return t;
  }
  function renderMarkdown(src, opts){
    opts = Object.assign({ imgBase: '' }, opts || {});
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [], list = null, quote = [];
    const flushPara = () => { if(para.length){ out.push('<p>' + para.map(l => inline(esc(l), opts)).join('<br>') + '</p>'); para = []; } };
    const flushList = () => { if(list){ out.push('<ul>' + list.map(l => '<li>' + inline(esc(l), opts) + '</li>').join('') + '</ul>'); list = null; } };
    const flushQuote = () => { if(quote.length){ out.push('<blockquote>' + quote.map(l => inline(esc(l), opts)).join('<br>') + '</blockquote>'); quote = []; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };
    for(const raw of lines){
      const line = raw.replace(/\s+$/, '');
      let m;
      if(!line.trim()){ flushAll(); continue; }
      if((m = line.match(/^(#{1,3})\s+(.*)$/))){
        flushAll();
        const lvl = m[1].length + 1; // # -> h2, ## -> h3, ### -> h4 (the post title is the h1)
        out.push('<h' + lvl + '>' + inline(esc(m[2]), opts) + '</h' + lvl + '>');
        continue;
      }
      if(/^(-{3,}|\*{3,})$/.test(line.trim())){ flushAll(); out.push('<hr>'); continue; }
      if((m = line.match(/^>\s?(.*)$/))){ flushPara(); flushList(); quote.push(m[1]); continue; }
      if((m = line.match(/^[-*]\s+(.*)$/))){ flushPara(); flushQuote(); (list = list || []).push(m[1]); continue; }
      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();
    return out.join('\n');
  }
  window.renderMarkdown = renderMarkdown;
})();
