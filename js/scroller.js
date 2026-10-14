/* No visible scrollbars anywhere: the browser's own bars are hidden on every
   scrolling area (site, admin, pop-out windows). Scrolling itself still works
   with the mouse wheel, trackpad, touch and keyboard. */
(function(){
  if(window.__scroller) return;
  window.__scroller = true;
  const style = document.createElement('style');
  style.textContent = [
    'html, body, *{ scrollbar-width:none; -ms-overflow-style:none; }',
    '*::-webkit-scrollbar{ display:none; width:0; height:0; background:transparent; }',
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);
})();
