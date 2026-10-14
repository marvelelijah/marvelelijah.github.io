/* Built-in scrollbars: the browser's own bars are hidden everywhere, and a thin
   thumb drawn by the site appears on the right edge of whatever is scrolling,
   then fades away. It can be dragged, and it widens when you hover it.
   Works for any scrolling area, including ones added later (pop-out windows). */
(function(){
  if(window.__scroller) return;
  window.__scroller = true;

  const css = [
    'html, body, *{ scrollbar-width:none; -ms-overflow-style:none; }',
    '*::-webkit-scrollbar{ display:none; width:0; height:0; }',
    '.vs-bar{ position:fixed; z-index:2147483000; width:12px; pointer-events:none; opacity:0; transition:opacity .35s ease; }',
    '.vs-bar.show{ opacity:1; }',
    '.vs-thumb{ position:absolute; right:3px; width:3px; border-radius:3px; background:var(--fg-dim, #7a7a73); pointer-events:auto; touch-action:none; transition:width .15s, right .15s, background .15s; }',
    '.vs-bar.show .vs-thumb:hover, .vs-bar.drag .vs-thumb{ width:6px; right:2px; background:var(--fg, #d8d8d2); }',
    '@media (pointer: coarse){ .vs-thumb{ pointer-events:none; } }',
  ].join('\n');
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  const bars = new Map();
  const MIN = 28;

  function isDoc(sc){ return sc === document || sc === document.documentElement || sc === document.body || sc === document.scrollingElement; }

  function make(sc){
    const doc = isDoc(sc);
    const box = doc ? (document.scrollingElement || document.documentElement) : sc;
    const bar = document.createElement('div');
    bar.className = 'vs-bar';
    bar.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'vs-thumb';
    bar.appendChild(thumb);
    document.body.appendChild(bar);
    let hideT = null, dragging = false, hovering = false;

    function geom(){
      const vh = doc ? window.innerHeight : box.clientHeight;
      const sh = box.scrollHeight;
      if(sh <= vh + 2) return null;
      let top = 0, right = window.innerWidth;
      if(!doc){
        const r = box.getBoundingClientRect();
        if(!r.width || !r.height) return null;
        top = r.top + box.clientTop;
        right = r.left + box.clientLeft + box.clientWidth;
      }
      const h = Math.max(MIN, vh * vh / sh);
      const t = (box.scrollTop / (sh - vh)) * (vh - h);
      return { vh, sh, top, right, h, t };
    }
    function place(){
      const g = geom();
      if(!g){ bar.style.display = 'none'; return null; }
      bar.style.display = '';
      bar.style.top = g.top + 'px';
      bar.style.left = (g.right - 12) + 'px';
      bar.style.height = g.vh + 'px';
      // stay above the thing being scrolled (pop-outs and overlays stack)
      if(!doc){
        let z = 0, n = box;
        while(n && n !== document.body){ const zi = parseInt(getComputedStyle(n).zIndex, 10); if(!isNaN(zi)) z = Math.max(z, zi); n = n.parentElement; }
        bar.style.zIndex = String(Math.max(z + 1, 61));
      }
      thumb.style.height = g.h + 'px';
      thumb.style.transform = 'translateY(' + g.t + 'px)';
      return g;
    }
    function show(){
      if(!place()) return;
      bar.classList.add('show');
      clearTimeout(hideT);
      hideT = setTimeout(() => { if(!dragging && !hovering) bar.classList.remove('show'); }, 900);
    }
    thumb.addEventListener('mouseenter', () => { hovering = true; clearTimeout(hideT); });
    thumb.addEventListener('mouseleave', () => { hovering = false; show(); });
    thumb.addEventListener('pointerdown', (e) => {
      const g = geom();
      if(!g) return;
      e.preventDefault();
      dragging = true;
      bar.classList.add('drag');
      const y0 = e.clientY, s0 = box.scrollTop;
      const k = (g.sh - g.vh) / Math.max(1, g.vh - g.h);
      try{ thumb.setPointerCapture(e.pointerId); }catch(err){}
      const move = (ev) => { box.scrollTop = s0 + (ev.clientY - y0) * k; };
      const up = () => {
        dragging = false;
        bar.classList.remove('drag');
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        show();
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
    // reveal it when the pointer comes near the right edge, so it can be grabbed
    (doc ? window : box).addEventListener('mousemove', (e) => {
      const g = geom();
      if(g && e.clientX > g.right - 16 && e.clientX <= g.right) show();
    }, { passive: true });
    return { show, place, bar, box };
  }

  function onScroll(e){
    let t = e.target;
    if(isDoc(t)) t = document;
    if(!t || (t !== document && !(t instanceof Element))) return;
    let b = bars.get(t);
    if(!b){ b = make(t); bars.set(t, b); }
    b.show();
  }
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', () => bars.forEach(b => b.place()), { passive: true });
  // drop bars whose scrolling area has gone (closed pop-outs, panels)
  setInterval(() => {
    bars.forEach((b, k) => { if(k !== document && !k.isConnected){ b.bar.remove(); bars.delete(k); } });
  }, 4000);
})();
