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

function escapeHtml(value, fallback = '') {
  return String(value ?? fallback)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function normalizePages(data) {
  intervalSeconds = Number(data.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  return (Array.isArray(data.pages) ? data.pages : [])
    .filter(page => page && page.enabled !== false)
    .slice(0, 10);
}

function getVersion(data) {
  return data?.meta?.version ?? data?.version ?? null;
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
  items.forEach(page => {
    if (page.image) {
      const img = new Image();
      img.src = page.image;
    }
  });
}

async function fetchContent() {
  const response = await fetch(`${CONTENT_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadContent() {
  try {
    const data = await fetchContent();
    const loadedPages = normalizePages(data);
    if (!loadedPages.length) throw new Error('Ingen aktive sider i content/pages.json');

    pages = loadedPages;
    lastLoadedVersion = getVersion(data);
    preloadImages(pages);
    currentIndex = 0;
    renderPage(pages[currentIndex]);
    startTimer();
    console.log('KHIF Info content loaded', { version: lastLoadedVersion, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    pages = [{
      kicker: 'Fejl',
      title: 'Kunne ikke hente indhold',
      text: 'Tjek content/pages.json og prøv igen.',
      footer: error.message,
      backgroundColor: '#7f1d1d',
      accentColor: '#fecaca'
    }];
    currentIndex = 0;
    renderPage(pages[0]);
  }
}

async function refreshContentIfChanged() {
  try {
    const data = await fetchContent();
    const newPages = normalizePages(data);
    if (!newPages.length) return;

    const newVersion = getVersion(data);
    const oldSerialized = JSON.stringify(pages);
    const newSerialized = JSON.stringify(newPages);

    if (newVersion !== lastLoadedVersion || newSerialized !== oldSerialized) {
      pages = newPages;
      lastLoadedVersion = newVersion;
      currentIndex = Math.min(currentIndex, pages.length - 1);
      preloadImages(pages);
      renderPage(pages[currentIndex]);
      startTimer();
      console.log('KHIF Info content refreshed', { version: lastLoadedVersion, refreshedAt: new Date().toISOString() });
    } else {
      console.log('KHIF Info content unchanged', { version: lastLoadedVersion, checkedAt: new Date().toISOString() });
    }
  } catch (error) {
    console.warn('Kunne ikke opdatere KHIF Info content endnu', error);
  }
}

window.addEventListener('keydown', event => {
  if (!pages.length) return;
  if (event.key === 'ArrowRight') nextPage();
  if (event.key === 'ArrowLeft') {
    currentIndex = (currentIndex - 1 + pages.length) % pages.length;
    renderPage(pages[currentIndex]);
  }
});

loadContent();
setInterval(refreshContentIfChanged, CONTENT_REFRESH_MINUTES * 60 * 1000);
