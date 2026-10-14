const FORMS_HOSTS = ['forms.jurajkurek.com'];

// Opens the survey page in its own fullscreen window. A new tab would make Chrome end Canva's
// fullscreen, which also ends the presentation; a separate window leaves it running, and when
// the survey page closes itself its window goes away and Canva is in front again.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'open-forms' || !sender.tab) return;
  let url;
  try {
    url = new URL(msg.url);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || !FORMS_HOSTS.includes(url.hostname)) return;
  chrome.windows.create({ url: url.href, state: 'fullscreen', focused: true });
});
