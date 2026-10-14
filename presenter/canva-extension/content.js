// While a Canva presentation is running, opens the survey page as soon as a slide with a link
// to it is on screen, so the presenter's arrow keys are enough.
const FORMS_HOSTS = ['forms.jurajkurek.com'];
const CHECK_MS = 400;

// Presenting starts with fullscreen. Fullscreen also ends when we open the survey tab, so a
// fullscreen exit right after opening keeps the presentation "on"; any other exit ends it.
let presenting = false;
let openedAt = 0;
let lastUrl = null; // link already opened for the slide currently on screen

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) presenting = true;
  else if (Date.now() - openedAt > 5000) presenting = false;
  console.info('[Forms z Canvy] prezentácia:', presenting ? 'beží' : 'nebeží');
});

// The link's own address, or one wrapped in a redirect (e.g. ...?target=<url>).
function formsUrl(href) {
  const candidates = [href];
  try {
    candidates.push(...new URL(href).searchParams.values());
  } catch {
    return null;
  }
  for (const c of candidates) {
    try {
      const url = new URL(c);
      if (url.protocol === 'https:' && FORMS_HOSTS.includes(url.hostname)) return url.href;
    } catch {}
  }
  return null;
}

function isOnScreen(rect, el) {
  const inViewport =
    rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  return inViewport && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

// Canva keeps link targets out of the page, so the address is also recognised when it is
// written as text on the slide (e.g. a text box "forms.jurajkurek.com/typ").
const TEXT_URL_RE = new RegExp(`(${FORMS_HOSTS.map((h) => h.replaceAll('.', '\\.')).join('|')})/[A-Za-z0-9-]+`);

function visibleFormsLink() {
  for (const a of document.querySelectorAll('a[href]')) {
    const url = formsUrl(a.href);
    if (url && isOnScreen(a.getBoundingClientRect(), a)) return url;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const match = TEXT_URL_RE.exec(node.textContent);
    if (!match || !node.parentElement) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (isOnScreen(range.getBoundingClientRect(), node.parentElement)) return `https://${match[0]}`;
  }
  return null;
}

setInterval(() => {
  if (!presenting || document.hidden) return;
  const url = visibleFormsLink();
  if (url === lastUrl) return;
  lastUrl = url;
  if (!url) return;
  openedAt = Date.now();
  console.info('[Forms z Canvy] otváram', url);
  chrome.runtime.sendMessage({ type: 'open-forms', url });
}, CHECK_MS);
