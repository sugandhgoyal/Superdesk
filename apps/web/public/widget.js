/**
 * SuperDesk embeddable chat widget loader.
 *
 * Usage:
 *   <script src="https://YOUR-DOMAIN/widget.js" data-workspace="your-slug" async></script>
 *
 * Deliberately framework-free and dependency-free — this is the one file of
 * the whole product that runs on a stranger's website, outside any build
 * step or bundler we control. It does the smallest possible thing: draw a
 * launcher bubble, and lazily mount an iframe (same-origin with our own API,
 * cross-origin from the host page) that owns everything else — auth, message
 * state, the live connection. All the loader and the iframe agree on is a
 * tiny postMessage contract: {source:'superdesk-widget', type:'close'|'message'}.
 */
(function () {
  var currentScript = document.currentScript;
  if (!currentScript) return;

  var slug = currentScript.getAttribute('data-workspace');
  if (!slug) {
    console.error('[SuperDesk] widget.js is missing a data-workspace attribute');
    return;
  }

  var origin = new URL(currentScript.src).origin;
  var Z = 2147483000; // above nearly anything a host page could set

  var bubble = document.createElement('button');
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:20px', 'width:56px', 'height:56px',
    'border-radius:50%', 'background:#4f46e5', 'border:none', 'cursor:pointer',
    'box-shadow:0 4px 16px rgba(0,0,0,.22)', 'z-index:' + Z,
    'display:flex', 'align-items:center', 'justify-content:center',
    'transition:transform .15s ease', 'padding:0',
  ].join(';');
  bubble.onmouseenter = function () { bubble.style.transform = 'scale(1.06)'; };
  bubble.onmouseleave = function () { bubble.style.transform = 'scale(1)'; };
  bubble.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.2-3.6A7.96 7.96 0 0 1 4 12Z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  var badge = document.createElement('span');
  badge.style.cssText = [
    'position:absolute', 'top:-2px', 'right:-2px', 'width:13px', 'height:13px',
    'border-radius:50%', 'background:#ef4444', 'border:2px solid #fff', 'display:none',
  ].join(';');
  bubble.appendChild(badge);

  var iframe = document.createElement('iframe');
  iframe.title = 'Chat';
  iframe.src = origin + '/widget/' + encodeURIComponent(slug);
  iframe.style.cssText = [
    'position:fixed', 'border:none', 'border-radius:16px',
    'box-shadow:0 12px 32px rgba(0,0,0,.24)', 'z-index:' + Z,
    'display:none', 'background:#fff', 'color-scheme:light',
  ].join(';');

  function layout() {
    var mobile = window.innerWidth <= 480;
    if (mobile) {
      iframe.style.cssText += ';top:0;left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0;';
    } else {
      iframe.style.width = '374px';
      iframe.style.height = '600px';
      iframe.style.maxHeight = 'calc(100vh - 110px)';
      iframe.style.bottom = '88px';
      iframe.style.right = '20px';
      iframe.style.top = 'auto';
      iframe.style.left = 'auto';
      iframe.style.borderRadius = '16px';
    }
  }

  var open = false;
  function setOpen(next) {
    open = next;
    layout();
    iframe.style.display = open ? 'block' : 'none';
    bubble.style.display = open && window.innerWidth <= 480 ? 'none' : 'flex';
    if (open) badge.style.display = 'none';
  }

  bubble.addEventListener('click', function () {
    setOpen(!open);
  });

  window.addEventListener('resize', function () {
    if (open) layout();
  });

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.source !== 'superdesk-widget') return;
    if (data.type === 'close') setOpen(false);
    if (data.type === 'message' && !open) badge.style.display = 'block';
  });

  function mount() {
    layout();
    document.body.appendChild(iframe);
    document.body.appendChild(bubble);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();
