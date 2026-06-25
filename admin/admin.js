(function () {
  const cfg = window.KHIF_ADMIN_SECRET;
  const $ = (id) => document.getElementById(id);
  const els = {
    loginPanel: $('loginPanel'), editorPanel: $('editorPanel'), logoutButton: $('logoutButton'),
    username: $('username'), password: $('password'), loginButton: $('loginButton'), loginMessage: $('loginMessage'),
    pageTabs: $('pageTabs'), form: $('editorForm'), saveMessage: $('saveMessage'), previewButton: $('previewButton'),
    enabled: $('enabled'), kicker: $('kicker'), title: $('title'), text: $('text'), footer: $('footer'),
    backgroundColor: $('backgroundColor'), textColor: $('textColor'), accentColor: $('accentColor'), image: $('image')
  };

  let token = null;
  let sha = null;
  let data = null;
  let selectedIndex = 0;

  function setMsg(el, msg, error) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', Boolean(error));
  }

  function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function b64ToUtf8(b64) {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: cfg.iterations || 250000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function decryptToken(password) {
    if (!window.crypto || !crypto.subtle) {
      throw new Error('Browseren understøtter ikke Web Crypto. Brug HTTPS eller en nyere browser.');
    }
    if (!cfg) {
      throw new Error('secret.js er ikke indlæst. Tjek at admin/secret.js findes.');
    }
    if (!cfg.encryptedToken || !cfg.salt || !cfg.iv) {
      throw new Error('secret.js er ikke genereret endnu. Brug tools/encrypt-token.html og commit outputtet til admin/secret.js.');
    }
    const key = await deriveKey(password, b64ToBytes(cfg.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(cfg.iv) },
      key,
      b64ToBytes(cfg.encryptedToken)
    );
    return new TextDecoder().decode(decrypted);
  }

  async function github(path, options = {}) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      ...options,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `GitHub API fejl ${res.status}`);
    return json;
  }

  async function loadPages() {
    const file = await github(cfg.contentPath);
    sha = file.sha;

    // GitHub returns base64 with line breaks. Avoid regex here to prevent generated escaping issues.
    const cleanContent = String(file.content || '').split('\n').join('');
    data = JSON.parse(b64ToUtf8(cleanContent));

    if (!Array.isArray(data.pages)) data.pages = [];
    while (data.pages.length < 10) {
      data.pages.push({
        enabled: true,
        kicker: 'KHIF Info',
        title: `Side ${data.pages.length + 1}`,
        text: '',
        footer: '',
        backgroundColor: '#111827',
        textColor: '#f9fafb',
        accentColor: '#f59e0b',
        image: ''
      });
    }
    data.pages = data.pages.slice(0, 10);
    renderTabs();
    fillForm();
  }

  function renderTabs() {
    els.pageTabs.innerHTML = '';
    data.pages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Side ${i + 1}: ${p.title || 'Uden titel'}`;
      btn.className = i === selectedIndex ? 'active' : '';
      btn.addEventListener('click', () => {
        saveCurrentToMemory();
        selectedIndex = i;
        renderTabs();
        fillForm();
      });
      els.pageTabs.appendChild(btn);
    });
  }

  function fillForm() {
    const p = data.pages[selectedIndex];
    els.enabled.checked = p.enabled !== false;
    els.kicker.value = p.kicker || '';
    els.title.value = p.title || '';
    els.text.value = p.text || '';
    els.footer.value = p.footer || '';
    els.backgroundColor.value = p.backgroundColor || '#111827';
    els.textColor.value = p.textColor || '#f9fafb';
    els.accentColor.value = p.accentColor || '#f59e0b';
    els.image.value = p.image || '';
  }

  function saveCurrentToMemory() {
    const p = data.pages[selectedIndex];
    Object.assign(p, {
      enabled: els.enabled.checked,
      kicker: els.kicker.value,
      title: els.title.value,
      text: els.text.value,
      footer: els.footer.value,
      backgroundColor: els.backgroundColor.value,
      textColor: els.textColor.value,
      accentColor: els.accentColor.value,
      image: els.image.value
    });
  }

  async function savePages() {
    saveCurrentToMemory();
    const body = {
      message: `Update KHIF Info content (${new Date().toLocaleString('da-DK')})`,
      content: utf8ToB64(JSON.stringify(data, null, 2) + '\n'),
      sha,
      branch: cfg.branch
    };
    const result = await github(cfg.contentPath, { method: 'PUT', body: JSON.stringify(body) });
    sha = result.content.sha;
    renderTabs();
  }

  async function login() {
    try {
      setMsg(els.loginMessage, 'Logger ind…');
      els.loginButton.disabled = true;

      if (!cfg || !cfg.adminUsername) throw new Error('Admin-konfiguration mangler i secret.js.');
      if ((els.username.value || '').trim() !== cfg.adminUsername) {
        throw new Error('Forkert brugernavn eller password.');
      }

      token = await decryptToken(els.password.value);
      await loadPages();

      els.loginPanel.classList.add('hidden');
      els.editorPanel.classList.remove('hidden');
      els.logoutButton.classList.remove('hidden');
      setMsg(els.loginMessage, '');
      els.password.value = '';
    } catch (e) {
      console.error(e);
      token = null;
      setMsg(els.loginMessage, e.message || String(e), true);
    } finally {
      els.loginButton.disabled = false;
    }
  }

  function init() {
    if (!els.loginButton) return;
    setMsg(els.loginMessage, 'Klar til login.');
    els.loginButton.addEventListener('click', login);
    els.password.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    els.form.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        setMsg(els.saveMessage, 'Gemmer til GitHub…');
        await savePages();
        setMsg(els.saveMessage, 'Gemt. GitHub Pages opdaterer typisk kort efter.');
      } catch (err) {
        console.error(err);
        setMsg(els.saveMessage, err.message || String(err), true);
      }
    });
    els.previewButton.addEventListener('click', () => window.open('../', '_blank'));
    els.logoutButton.addEventListener('click', () => location.reload());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
