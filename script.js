const CONTENT_URL = './content/pages.json';
const DEFAULT_INTERVAL_SECONDS = 30;
const CONTENT_REFRESH_MINUTES = 5;

const app = document.querySelector('#app');
const progressBar = document.querySelector('#progressBar');
let pages = [];
let currentIndex = 0;
let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
let timerId = null;
let lastLoadedVersion = null;
let globalConfig = {};

const DEFAULT_CONFIG = {
  fontSizes: { kicker: 2.2, title: 7.0, text: 3.0, footer: 1.3 }
};

function escapeHtml(value, fallback = '') {
  return String(value ?? fallback)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function normalizeConfig(data) {
  const incoming = data?.config || data?.settings || {};
  const fontSizes = { ...DEFAULT_CONFIG.fontSizes, ...(incoming.fontSizes || {}) };
  return { ...DEFAULT_CONFIG, ...incoming, fontSizes };
}

function asRem(value, fallback) {
  const num = Number(value);
  return `${Number.isFinite(num) ? num : fallback}rem`;
}

function applyConfig(config) {
  const sizes = config.fontSizes || DEFAULT_CONFIG.fontSizes;
  document.documentElement.style.setProperty('--kicker-size', asRem(sizes.kicker, DEFAULT_CONFIG.fontSizes.kicker));
  document.documentElement.style.setProperty('--title-size', asRem(sizes.title, DEFAULT_CONFIG.fontSizes.title));
  document.documentElement.style.setProperty('--text-size', asRem(sizes.text, DEFAULT_CONFIG.fontSizes.text));
  document.documentElement.style.setProperty('--footer-size', asRem(sizes.footer, DEFAULT_CONFIG.fontSizes.footer));
}

function normalizePages(data) {
  intervalSeconds = Number(data.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  return (Array.isArray(data.pages) ? data.pages : []).filter(page => page && page.enabled !== false);
}

function getVersion(data) { return data?.meta?.version ?? data?.version ?? null; }

function setTheme(page) {
  document.documentElement.style.setProperty('--bg', page.backgroundColor || '#111827');
  document.documentElement.style.setProperty('--fg', page.textColor || '#f9fafb');
  document.documentElement.style.setProperty('--accent', page.accentColor || '#f59e0b');
  // Vigtigt: billeder må ikke længere bruges som fullscreen baggrund.
  app.style.backgroundImage = 'none';
}

function restartProgress() {
  progressBar.classList.remove('run');
  progressBar.style.animationDuration = `${intervalSeconds}s`;
  void progressBar.offsetWidth;
  progressBar.classList.add('run');
}

function renderPage(page) {
  setTheme(page);
  const imageUrl = String(page.image || '').trim();
  const hasImage = Boolean(imageUrl);
  app.innerHTML = `
    <section class="slide ${hasImage ? 'has-image' : ''}">
      <div class="slide-copy">
        ${page.kicker ? `<p class="eyebrow">${escapeHtml(page.kicker)}</p>` : ''}
        <h1>${escapeHtml(page.title, 'Uden titel')}</h1>
        <p class="body">${escapeHtml(page.text)}</p>
        <div class="meta"><span>Side ${currentIndex + 1} / ${pages.length}</span>${page.footer ? `<span>•</span><span>${escapeHtml(page.footer)}</span>` : ''}</div>
      </div>
      ${hasImage ? `<figure class="slide-image-wrap"><img src="${escapeHtml(imageUrl)}" alt="" loading="eager" /></figure>` : ''}
    </section>`;
  restartProgress();
}

function nextPage() {
  if (!pages.length) return;
  currentIndex = (currentIndex + 1) % pages.length;
  renderPage(pages[currentIndex]);
}

function startTimer() {
  if (timerId) clearInterval(timerId);
  timerId = setInterval(nextPage, intervalSeconds * 1000);
}

function preloadImages(items) {
  items.forEach(page => { if (page.image) { const img = new Image(); img.src = page.image; } });
}

async function fetchContent() {
  const response = await fetch(`${CONTENT_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadContent() {
  try {
    const data = await fetchContent();
    globalConfig = normalizeConfig(data);
    applyConfig(globalConfig);
    const loadedPages = normalizePages(data);
    if (!loadedPages.length) throw new Error('Ingen aktive sider i content/pages.json');
    pages = loadedPages;
    lastLoadedVersion = getVersion(data);
    preloadImages(pages);
    currentIndex = 0;
    renderPage(pages[currentIndex]);
    startTimer();
    console.log('KHIF Info content loaded', { version: lastLoadedVersion, config: globalConfig, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    pages = [{ kicker: 'Fejl', title: 'Kunne ikke hente indhold', text: 'Tjek content/pages.json og prøv igen.', footer: error.message, backgroundColor: '#7f1d1d', accentColor: '#fecaca' }];
    currentIndex = 0;
    renderPage(pages[0]);
  }
}

async function refreshContentIfChanged() {
  try {
    const data = await fetchContent();
    const newConfig = normalizeConfig(data);
    const newPages = normalizePages(data);
    if (!newPages.length) return;
    const newVersion = getVersion(data);
    const oldSerialized = JSON.stringify({ pages, config: globalConfig });
    const newSerialized = JSON.stringify({ pages: newPages, config: newConfig });
    if (newVersion !== lastLoadedVersion || newSerialized !== oldSerialized) {
      pages = newPages;
      globalConfig = newConfig;
      applyConfig(globalConfig);
      lastLoadedVersion = newVersion;
      currentIndex = Math.min(currentIndex, pages.length - 1);
      preloadImages(pages);
      renderPage(pages[currentIndex]);
      startTimer();
      console.log('KHIF Info content refreshed', { version: lastLoadedVersion, config: globalConfig, refreshedAt: new Date().toISOString() });
    }
  } catch (error) { console.warn('Kunne ikke opdatere KHIF Info content endnu', error); }
}

window.addEventListener('keydown', event => {
  if (!pages.length) return;
  if (event.key === 'ArrowRight') nextPage();
  if (event.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + pages.length) % pages.length; renderPage(pages[currentIndex]); }
});

loadContent();
setInterval(refreshContentIfChanged, CONTENT_REFRESH_MINUTES * 60 * 1000);
