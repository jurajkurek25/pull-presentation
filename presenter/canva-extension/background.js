const FORMS_HOSTS = ['forms.jurajkurek.com'];

// Opens the survey page next to the Canva tab. Because Canva is its opener, Chrome
// returns to the Canva tab when the survey page closes itself.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'open-forms' || !sender.tab) return;
  let url;
  try {
    url = new URL(msg.url);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || !FORMS_HOSTS.includes(url.hostname)) return;
  chrome.tabs.create({ url: url.href, openerTabId: sender.tab.id, index: sender.tab.index + 1 });
});
