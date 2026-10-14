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

function visibleFormsLink() {
  for (const a of document.querySelectorAll('a[href]')) {
    const url = formsUrl(a.href);
    if (!url) continue;
    const r = a.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    if (onScreen && a.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return url;
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
  chrome.runtime.sendMessage({ type: 'open-forms', url });
}, CHECK_MS);
