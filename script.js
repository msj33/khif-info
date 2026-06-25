const CONTENT_URL = './content/pages.json';
const DEFAULT_INTERVAL_SECONDS = 30;

const app = document.querySelector('#app');
const progressBar = document.querySelector('#progressBar');

let pages = [];
let currentIndex = 0;
let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
let startedAt = Date.now();

function safeText(value, fallback = '') {
  return String(value ?? fallback);
}

function normalizePages(data) {
  intervalSeconds = Number(data.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  const configuredPages = Array.isArray(data.pages) ? data.pages : [];

  return configuredPages
    .filter(page => page && page.enabled !== false)
    .slice(0, 10);
}

function renderPage(page) {
  const bg = page.backgroundColor || '#111827';
  const fg = page.textColor || '#f9fafb';
  const accent = page.accentColor || '#f59e0b';

  document.documentElement.style.setProperty('--bg', bg);
  document.documentElement.style.setProperty('--fg', fg);
  document.documentElement.style.setProperty('--accent', accent);

  app.classList.toggle('has-image', Boolean(page.image));
  app.style.backgroundImage = page.image
    ? `linear-gradient(120deg, rgba(0,0,0,.62), rgba(0,0,0,.22)), url('${page.image}')`
    : '';

  app.innerHTML = `
    <section class="slide" key="${currentIndex}">
      ${page.kicker ? `<p class="eyebrow">${safeText(page.kicker)}</p>` : ''}
      <h1>${safeText(page.title, 'Uden titel')}</h1>
      <p class="body">${safeText(page.text)}</p>
      <div class="meta">
        <span>Side ${currentIndex + 1} / ${pages.length}</span>
        ${page.footer ? `<span>•</span><span>${safeText(page.footer)}</span>` : ''}
      </div>
    </section>
  `;

  startedAt = Date.now();
  progressBar.style.transition = 'none';
  progressBar.style.width = '0%';
  requestAnimationFrame(() => {
    progressBar.style.transition = `width ${intervalSeconds}s linear`;
    progressBar.style.width = '100%';
  });
}

function nextPage() {
  if (!pages.length) return;
  currentIndex = (currentIndex + 1) % pages.length;
  renderPage(pages[currentIndex]);
}

async function loadContent() {
  try {
    const response = await fetch(`${CONTENT_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    pages = normalizePages(data);

    if (!pages.length) throw new Error('Ingen aktive sider i content/pages.json');

    currentIndex = 0;
    renderPage(pages[currentIndex]);
    window.setInterval(nextPage, intervalSeconds * 1000);
  } catch (error) {
    console.error(error);
    renderPage({
      kicker: 'Fejl',
      title: 'Kunne ikke hente indhold',
      text: 'Tjek content/pages.json og prøv igen.',
      footer: error.message,
      backgroundColor: '#7f1d1d',
      accentColor: '#fecaca'
    });
  }
}

// Tastaturgenveje til test på PC: højre/venstre pil skifter slide.
window.addEventListener('keydown', (event) => {
  if (!pages.length) return;
  if (event.key === 'ArrowRight') nextPage();
  if (event.key === 'ArrowLeft') {
    currentIndex = (currentIndex - 1 + pages.length) % pages.length;
    renderPage(pages[currentIndex]);
  }
});

loadContent();
