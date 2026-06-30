(function () {
  const cfg = window.KHIF_ADMIN_SECRET;
  const $ = (id) => document.getElementById(id);
  const els = {
    loginPanel: $('loginPanel'), editorPanel: $('editorPanel'), logoutButton: $('logoutButton'),
    username: $('username'), password: $('password'), loginButton: $('loginButton'), loginMessage: $('loginMessage'),
    pageTabs: $('pageTabs'), form: $('editorForm'), saveMessage: $('saveMessage'), previewButton: $('previewButton'),
    basisConfigPanel: $('basisConfigPanel'), pageEditorPanel: $('pageEditorPanel'),
    fontKicker: $('fontKicker'), fontTitle: $('fontTitle'), fontText: $('fontText'), fontFooter: $('fontFooter'),
    kickerSizeValue: $('kickerSizeValue'), titleSizeValue: $('titleSizeValue'), textSizeValue: $('textSizeValue'), footerSizeValue: $('footerSizeValue'),
    addPageButton: $('addPageButton'), removePageButton: $('removePageButton'),
    enabled: $('enabled'), kicker: $('kicker'), title: $('title'), text: $('text'), footer: $('footer'),
    backgroundColor: $('backgroundColor'), textColor: $('textColor'), accentColor: $('accentColor'), image: $('image'), imageUpload: $('imageUpload'), uploadHint: $('uploadHint'),
    repoVersion: $('repoVersion'), repoUpdated: $('repoUpdated'), deployedVersion: $('deployedVersion'), deployedUpdated: $('deployedUpdated'),
    deployStatus: $('deployStatus'), commitLink: $('commitLink'), checkDeployButton: $('checkDeployButton')
  };

  const DEFAULT_CONFIG = { fontSizes: { kicker: 2.2, title: 7.0, text: 3.0, footer: 1.3 } };
  let token = null;
  let sha = null;
  let data = null;
  let selectedIndex = -1; // -1 = Basis Config
  let latestCommitSha = null;

  function setMsg(el, msg, error) { if (!el) return; el.textContent = msg || ''; el.classList.toggle('error', Boolean(error)); }
  function formatDate(value) { if (!value) return '-'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('da-DK'); }
  function versionOf(obj) { return obj?.meta?.version ?? obj?.version ?? 0; }
  function updatedAtOf(obj) { return obj?.meta?.updatedAt ?? obj?.updatedAt ?? null; }

  function ensureMeta() {
    if (!data.meta || typeof data.meta !== 'object') data.meta = {};
    if (!Number.isFinite(Number(data.meta.version))) data.meta.version = 0;
    return data.meta;
  }

  function ensureConfig() {
    if (!data.config || typeof data.config !== 'object') data.config = {};
    if (!data.config.fontSizes || typeof data.config.fontSizes !== 'object') data.config.fontSizes = {};
    data.config.fontSizes = { ...DEFAULT_CONFIG.fontSizes, ...data.config.fontSizes };
    return data.config;
  }

  function updateRepoStatus() {
    const meta = ensureMeta();
    els.repoVersion.textContent = `v${meta.version}`;
    els.repoUpdated.textContent = `Opdateret: ${formatDate(meta.updatedAt)}`;
    if (latestCommitSha) {
      const shortSha = latestCommitSha.slice(0, 7);
      els.commitLink.innerHTML = `<a href="https://github.com/${cfg.owner}/${cfg.repo}/commit/${latestCommitSha}" target="_blank" rel="noopener">Commit ${shortSha}</a>`;
    }
  }

  function setDeployPill(text, cls) { els.deployStatus.textContent = text; els.deployStatus.className = `status-pill ${cls || 'neutral'}`; }
  function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
  function utf8ToB64(str) { const bytes = new TextEncoder().encode(str); let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b)); return btoa(binary); }
  function b64ToUtf8(b64) { const binary = atob(b64); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }

  async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: cfg.iterations || 250000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  async function decryptToken(password) {
    if (!window.crypto || !crypto.subtle) throw new Error('Browseren understøtter ikke Web Crypto. Brug HTTPS eller en nyere browser.');
    if (!cfg) throw new Error('secret.js er ikke indlæst. Tjek at admin/secret.js findes.');
    if (!cfg.encryptedToken || !cfg.salt || !cfg.iv) throw new Error('secret.js er ikke genereret endnu. Brug tools/encrypt-token.html og commit outputtet til admin/secret.js.');
    const key = await deriveKey(password, b64ToBytes(cfg.salt));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(cfg.iv) }, key, b64ToBytes(cfg.encryptedToken));
    return new TextDecoder().decode(decrypted);
  }

  async function githubContent(path, options = {}) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      ...options,
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `GitHub API fejl ${res.status}`);
    return json;
  }

  function createDefaultPage(n) {
    return { enabled: true, kicker: 'KHIF Info', title: `Ny page ${n}`, text: '', footer: '', backgroundColor: '#111827', textColor: '#f9fafb', accentColor: '#f59e0b', image: '' };
  }

  async function loadPages() {
    const file = await githubContent(cfg.contentPath);
    sha = file.sha;
    const cleanContent = String(file.content || '').split('\n').join('');
    data = JSON.parse(b64ToUtf8(cleanContent));
    if (!Array.isArray(data.pages)) data.pages = [];
    if (!data.pages.length) data.pages.push(createDefaultPage(1));
    ensureMeta(); ensureConfig();
    renderTabs(); fillBasisForm(); fillForm(); updateRepoStatus(); await checkDeployedVersion();
  }

  async function checkDeployedVersion() {
    try {
      setDeployPill('Tjekker…', 'neutral');
      const res = await fetch(`../${cfg.contentPath}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const deployed = await res.json();
      const deployedVersion = Number(versionOf(deployed));
      const repoVersion = Number(versionOf(data));
      els.deployedVersion.textContent = `v${deployedVersion || 0}`;
      els.deployedUpdated.textContent = `Opdateret: ${formatDate(updatedAtOf(deployed))}`;
      setDeployPill(deployedVersion === repoVersion ? 'Deployed' : 'Afventer deploy/cache', deployedVersion === repoVersion ? 'ok' : 'pending');
    } catch (e) {
      console.warn(e); els.deployedVersion.textContent = '-'; els.deployedUpdated.textContent = e.message || String(e); setDeployPill('Kunne ikke tjekke', 'error');
    }
  }

  function renderTabs() {
    els.pageTabs.innerHTML = '';
    const basisBtn = document.createElement('button');
    basisBtn.type = 'button'; basisBtn.textContent = 'Basis Config'; basisBtn.className = selectedIndex === -1 ? 'active' : '';
    basisBtn.addEventListener('click', () => { saveCurrentToMemory(); selectedIndex = -1; renderTabs(); fillBasisForm(); toggleEditorPanels(); });
    els.pageTabs.appendChild(basisBtn);
    data.pages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = `Page ${i + 1}: ${p.title || 'Uden titel'}`; btn.className = i === selectedIndex ? 'active' : '';
      btn.addEventListener('click', () => { saveCurrentToMemory(); selectedIndex = i; renderTabs(); fillForm(); toggleEditorPanels(); });
      els.pageTabs.appendChild(btn);
    });
    els.removePageButton.disabled = selectedIndex < 0 || data.pages.length <= 1;
  }

  function toggleEditorPanels() {
    els.basisConfigPanel.classList.toggle('hidden', selectedIndex !== -1);
    els.pageEditorPanel.classList.toggle('hidden', selectedIndex === -1);
    els.removePageButton.disabled = selectedIndex < 0 || data.pages.length <= 1;
  }

  function updateSizeLabels() {
    els.kickerSizeValue.textContent = `${els.fontKicker.value}rem`;
    els.titleSizeValue.textContent = `${els.fontTitle.value}rem`;
    els.textSizeValue.textContent = `${els.fontText.value}rem`;
    els.footerSizeValue.textContent = `${els.fontFooter.value}rem`;
  }

  function fillBasisForm() {
    const config = ensureConfig(); const s = config.fontSizes;
    els.fontKicker.value = s.kicker; els.fontTitle.value = s.title; els.fontText.value = s.text; els.fontFooter.value = s.footer; updateSizeLabels(); toggleEditorPanels();
  }

  function saveBasisToMemory() {
    const config = ensureConfig();
    config.fontSizes = { kicker: Number(els.fontKicker.value), title: Number(els.fontTitle.value), text: Number(els.fontText.value), footer: Number(els.fontFooter.value) };
  }

  function fillForm() {
    if (selectedIndex < 0) { toggleEditorPanels(); return; }
    const p = data.pages[selectedIndex];
    els.enabled.checked = p.enabled !== false; els.kicker.value = p.kicker || ''; els.title.value = p.title || ''; els.text.value = p.text || ''; els.footer.value = p.footer || '';
    els.backgroundColor.value = p.backgroundColor || '#111827'; els.textColor.value = p.textColor || '#f9fafb'; els.accentColor.value = p.accentColor || '#f59e0b'; els.image.value = p.image || ''; els.imageUpload.value = '';
    toggleEditorPanels();
  }

  function saveCurrentToMemory() {
    if (!data) return;
    saveBasisToMemory();
    if (selectedIndex < 0 || !data.pages[selectedIndex]) return;
    const p = data.pages[selectedIndex];
    Object.assign(p, { enabled: els.enabled.checked, kicker: els.kicker.value, title: els.title.value, text: els.text.value, footer: els.footer.value, backgroundColor: els.backgroundColor.value, textColor: els.textColor.value, accentColor: els.accentColor.value, image: els.image.value });
  }

  function sanitizeFilename(name) {
    const ext = (name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'jpg';
    const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
    return `${Date.now()}-${base}.${ext}`;
  }

  async function fileToBase64(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer); let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b)); return btoa(binary);
  }

  async function uploadSelectedImageIfNeeded() {
    if (selectedIndex < 0 || !els.imageUpload.files || !els.imageUpload.files[0]) return null;
    const file = els.imageUpload.files[0];
    if (!file.type.startsWith('image/')) throw new Error('Den valgte fil er ikke et billede.');
    const filename = sanitizeFilename(file.name);
    const path = `assets/uploads/${filename}`;
    const content = await fileToBase64(file);
    await githubContent(path, { method: 'PUT', body: JSON.stringify({ message: `Upload KHIF Info image ${filename}`, content, branch: cfg.branch }) });
    return `/khif-info/${path}`;
  }

  async function savePages() {
    let uploadedImageUrl = await uploadSelectedImageIfNeeded();
    if (uploadedImageUrl && selectedIndex >= 0) els.image.value = uploadedImageUrl;
    saveCurrentToMemory();
    const meta = ensureMeta(); meta.version = Number(meta.version || 0) + 1; meta.updatedAt = new Date().toISOString(); meta.updatedBy = cfg.adminUsername || 'admin';
    const body = { message: `Update KHIF Info content v${meta.version}`, content: utf8ToB64(JSON.stringify(data, null, 2) + '\n'), sha, branch: cfg.branch };
    const result = await githubContent(cfg.contentPath, { method: 'PUT', body: JSON.stringify(body) });
    sha = result.content.sha; latestCommitSha = result.commit?.sha || null;
    renderTabs(); fillBasisForm(); if (selectedIndex >= 0) fillForm(); updateRepoStatus(); await checkDeployedVersion();
  }

  async function login() {
    try {
      setMsg(els.loginMessage, 'Logger ind…'); els.loginButton.disabled = true;
      if (!cfg || !cfg.adminUsername) throw new Error('Admin-konfiguration mangler i secret.js.');
      if ((els.username.value || '').trim() !== cfg.adminUsername) throw new Error('Forkert brugernavn eller password.');
      token = await decryptToken(els.password.value); await loadPages();
      els.loginPanel.classList.add('hidden'); els.editorPanel.classList.remove('hidden'); els.logoutButton.classList.remove('hidden'); setMsg(els.loginMessage, ''); els.password.value = '';
    } catch (e) { console.error(e); token = null; setMsg(els.loginMessage, e.message || String(e), true); }
    finally { els.loginButton.disabled = false; }
  }

  function addPage() {
    saveCurrentToMemory(); data.pages.push(createDefaultPage(data.pages.length + 1)); selectedIndex = data.pages.length - 1; renderTabs(); fillForm(); setMsg(els.saveMessage, 'Ny page tilføjet. Husk at trykke Gem ændringer.');
  }

  function removePage() {
    if (selectedIndex < 0 || data.pages.length <= 1) return;
    const pageTitle = data.pages[selectedIndex].title || `Page ${selectedIndex + 1}`;
    if (!confirm(`Fjern "${pageTitle}"? Husk at trykke Gem ændringer bagefter.`)) return;
    data.pages.splice(selectedIndex, 1); selectedIndex = Math.min(selectedIndex, data.pages.length - 1); renderTabs(); fillForm(); setMsg(els.saveMessage, 'Page fjernet. Husk at trykke Gem ændringer.');
  }

  function init() {
    if (!els.loginButton) return;
    setMsg(els.loginMessage, 'Klar til login.');
    els.loginButton.addEventListener('click', login);
    els.password.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    [els.fontKicker, els.fontTitle, els.fontText, els.fontFooter].forEach(el => el.addEventListener('input', updateSizeLabels));
    els.addPageButton.addEventListener('click', addPage); els.removePageButton.addEventListener('click', removePage);
    els.form.addEventListener('submit', async e => {
      e.preventDefault();
      try { setMsg(els.saveMessage, els.imageUpload.files?.[0] ? 'Uploader billede og gemmer til GitHub…' : 'Gemmer til GitHub…'); await savePages(); setMsg(els.saveMessage, 'Gemt. GitHub Pages opdaterer typisk kort efter.'); }
      catch (err) { console.error(err); setMsg(els.saveMessage, err.message || String(err), true); }
    });
    els.previewButton.addEventListener('click', () => window.open('../', '_blank'));
    els.logoutButton.addEventListener('click', () => location.reload());
    els.checkDeployButton.addEventListener('click', checkDeployedVersion);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
