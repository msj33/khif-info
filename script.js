const CONTENT_URL = './content/pages.json';
const DEFAULT_INTERVAL_SECONDS = 30;
const app = document.querySelector('#app');
const progressBar = document.querySelector('#progressBar');
let pages = [];
let currentIndex = 0;
let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
let timerId = null;

function escapeHtml(value, fallback = '') {
  return String(value ?? fallback).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function normalizePages(data) {
  intervalSeconds = Number(data.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  return (Array.isArray(data.pages) ? data.pages : []).filter(page => page && page.enabled !== false).slice(0, 10);
}
function setTheme(page) {
  document.documentElement.style.setProperty('--bg', page.backgroundColor || '#111827');
  document.documentElement.style.setProperty('--fg', page.textColor || '#f9fafb');
  document.documentElement.style.setProperty('--accent', page.accentColor || '#f59e0b');
  app.style.backgroundImage = page.image ? `url('${page.image}')` : '';
}
function restartProgress() {
  progressBar.classList.remove('run');
  progressBar.style.animationDuration = `${intervalSeconds}s`;
  void progressBar.offsetWidth;
  progressBar.classList.add('run');
}
function renderPage(page) {
  setTheme(page);
  app.innerHTML = `
    <section class="slide">
      ${page.kicker ? `<p class="eyebrow">${escapeHtml(page.kicker)}</p>` : ''}
      <h1>${escapeHtml(page.title, 'Uden titel')}</h1>
      <p class="body">${escapeHtml(page.text)}</p>
      <div class="meta"><span>Side ${currentIndex + 1} / ${pages.length}</span>${page.footer ? `<span>•</span><span>${escapeHtml(page.footer)}</span>` : ''}</div>
    </section>`;
  restartProgress();
}
function nextPage() { if (!pages.length) return; currentIndex = (currentIndex + 1) % pages.length; renderPage(pages[currentIndex]); }
function startTimer() { if (timerId) clearInterval(timerId); timerId = setInterval(nextPage, intervalSeconds * 1000); }
async function loadContent() {
  try {
    const response = await fetch(`${CONTENT_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    pages = normalizePages(data);
    if (!pages.length) throw new Error('Ingen aktive sider i content/pages.json');
    pages.forEach(page => { if (page.image) { const img = new Image(); img.src = page.image; } });
    currentIndex = 0; renderPage(pages[currentIndex]); startTimer();
  } catch (error) {
    console.error(error);
    pages = [{ kicker: 'Fejl', title: 'Kunne ikke hente indhold', text: 'Tjek content/pages.json og prøv igen.', footer: error.message, backgroundColor: '#7f1d1d', accentColor: '#fecaca' }];
    currentIndex = 0; renderPage(pages[0]);
  }
}
window.addEventListener('keydown', event => {
  if (!pages.length) return;
  if (event.key === 'ArrowRight') nextPage();
  if (event.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + pages.length) % pages.length; renderPage(pages[currentIndex]); }
});
loadContent();

// Reload infoskærmen hvert 30. minut, så nyt GitHub Pages-content bliver hentet.
const AUTO_RELOAD_MINUTES = 30;

window.setTimeout(() => {
  const url = new URL(window.location.href);
  url.searchParams.set('refresh', Date.now().toString());

  // replace() undgår at fylde browser history på Raspberry Pi/kiosk.
  window.location.replace(url.toString());
}, AUTO_RELOAD_MINUTES * 60 * 1000);
