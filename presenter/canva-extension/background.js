const FORMS_HOSTS = ['forms.jurajkurek.com'];

// Opens the survey page in its own fullscreen window. A new tab would make Chrome end Canva's
// fullscreen, which also ends the presentation; a separate window leaves it running, and when
// the survey page closes itself its window goes away and Canva is in front again.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'open-forms' || !sender.tab) return;
  let url;
  try {
    url = new URL(msg.url);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || !FORMS_HOSTS.includes(url.hostname)) return;
  openSurvey(url.href, sender.tab).then(sendResponse, (e) => sendResponse({ how: `chyba: ${e.message}` }));
  return true; // answer asynchronously
});

async function openSurvey(url, canvaTab) {
  try {
    const win = await chrome.windows.create({ url, state: 'fullscreen', focused: true });
    // Ask again: on Windows a new window can otherwise stay behind Canva's fullscreen window.
    await chrome.windows.update(win.id, { focused: true });
    return { how: 'v samostatnom okne' };
  } catch (e) {
    // Fall back to the old behaviour (works, but ends Canva's fullscreen).
    await chrome.tabs.create({ url, openerTabId: canvaTab.id, index: canvaTab.index + 1 });
    return { how: `v karte, lebo okno sa nepodarilo otvoriť: ${e.message}` };
  }
}
