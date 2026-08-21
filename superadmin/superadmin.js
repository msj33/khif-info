(function () {
  'use strict';

  const CONFIG = window.KHIF_ADMIN_SECRET;
  const STATE_OWNER = 'msj33';
  const STATE_REPO = 'khif-info-state';
  const STATE_BRANCH = 'main';
  const DEVICE_ID = 'khif-infoscreen-01';
  const COMMAND_PATH = 'remote/command.json';
  const STATUS_PATH = `remote/status/${DEVICE_ID}.json`;
  const SCHEDULE_PATH = 'remote/screen-schedule.json';
  const LOGINS_PATH = 'content/logins.json';
  const AREAS_PATH = 'content/areas.json';
  const DEFAULT_AREAS = ['KHIF - Info', 'Fodbold', 'Badminton', 'Gymnastik', 'Tennis', 'Volleyball', 'Fitness', 'Andet'];
  const POLL_MS = 5000;
  const OFFLINE_AFTER_MS = 2 * 60 * 1000;
  const $ = id => document.getElementById(id);

  let token = null;
  let commandSha = null;
  let statusTimer = null;
  let scheduleSha = null;
  let scheduleData = null;
  let commandInFlight = false;
  let commandCooldownUntil = 0;
  let loginsSha = null;
  let loginsData = null;
  let areasSha = null;
  let areasData = null;
  let currentLoginUsername = '';

  const els = {
    loginPanel: $('loginPanel'),
    superPanel: $('superPanel'),
    logoutButton: $('logoutButton'),
    username: $('username'),
    password: $('password'),
    loginButton: $('loginButton'),
    loginMessage: $('loginMessage'),
    onlinePill: $('onlinePill'),
    deviceTitle: $('deviceTitle'),
    lastSeen: $('lastSeen'),
    hostname: $('hostname'),
    uptime: $('uptime'),
    temperature: $('temperature'),
    browser: $('browser'),
    screenPower: $('screenPower'),
    lastCommand: $('lastCommand'),
    lastError: $('lastError'),
    rawStatus: $('rawStatus'),
    reloadPageButton: $('reloadPageButton'),
    restartBrowserButton: $('restartBrowserButton'),
    turnScreenOnButton: $('turnScreenOnButton'),
    turnScreenOffButton: $('turnScreenOffButton'),
    rebootPiButton: $('rebootPiButton'),
    commandMessage: $('commandMessage'),
    scheduleEnabled: $('scheduleEnabled'),
    scheduleDays: $('scheduleDays'),
    scheduleSummary: $('scheduleSummary'),
    scheduleMessage: $('scheduleMessage'),
    scheduleJson: $('scheduleJson'),
    saveScheduleButton: $('saveScheduleButton'),
    refreshScheduleButton: $('refreshScheduleButton'),
    refreshScheduleOnPiButton: $('refreshScheduleOnPiButton'),
    newLoginUsername: $('newLoginUsername'),
    newLoginPassword: $('newLoginPassword'),
    newLoginRole: $('newLoginRole'),
    addLoginButton: $('addLoginButton'),
    loginList: $('loginList'),
    loginAdminMessage: $('loginAdminMessage'),
    newAreaName: $('newAreaName'),
    addAreaButton: $('addAreaButton'),
    areaList: $('areaList'),
    areaAdminMessage: $('areaAdminMessage')
  };

  function msg(el, text, error = false) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!error);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || '');
    if (error?.name === 'OperationError' || message.includes('OperationError')) return 'Forkert brugernavn eller password.';
    if (message.includes('does not match') || message.includes('sha') || message.includes('conflict')) return 'Afvent venligst 30 sekunder, før du forsøger ny kommando.';
    return message || String(error || 'Ukendt fejl');
  }

  function b64ToBytes(b64) {
    return Uint8Array.from(atob(String(b64 || '')), c => c.charCodeAt(0));
  }

  function bytesToB64(bytes) {
    let bin = '';
    bytes.forEach(b => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(String(b64 || '').replace(/\n/g, '')), c => c.charCodeAt(0)));
  }

  function utf8ToB64(text) {
    const bytes = new TextEncoder().encode(text);
    return bytesToB64(bytes);
  }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iterations || 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function decryptWithCredential(password, credential) {
    const key = await deriveKey(password, b64ToBytes(credential.salt), Number(credential.iterations || 250000));
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(credential.iv) }, key, b64ToBytes(credential.encryptedToken));
    return new TextDecoder().decode(dec);
  }

  async function encryptTokenForPassword(plainToken, password, iterations = 250000) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iterations);
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainToken));
    return {
      iterations,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      encryptedToken: bytesToB64(new Uint8Array(enc))
    };
  }

  function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeRole(value) {
    return value === 'superadmin' ? 'superadmin' : 'admin';
  }

  function defaultLogins() {
    const username = normalizeUsername(CONFIG.adminUsername || 'admin');
    return {
      version: 2,
      users: [
        {
          username,
          role: 'superadmin',
          iterations: Number(CONFIG.iterations || 250000),
          salt: String(CONFIG.salt || ''),
          iv: String(CONFIG.iv || ''),
          encryptedToken: String(CONFIG.encryptedToken || '')
        }
      ],
      updatedAt: new Date().toISOString(),
      updatedBy: 'bootstrap'
    };
  }

  function normalizeLogins(logins) {
    const base = defaultLogins();
    const src = Array.isArray(logins?.users) ? logins.users : [];
    const users = [];
    src.forEach(entry => {
      const username = normalizeUsername(entry?.username);
      if (!username) return;
      const role = normalizeRole(entry?.role);
      const iterations = Number(entry?.iterations || CONFIG.iterations || 250000);
      const salt = String(entry?.salt || '');
      const iv = String(entry?.iv || '');
      const encryptedToken = String(entry?.encryptedToken || '');
      if (!salt || !iv || !encryptedToken) return;
      if (users.some(u => u.username === username)) return;
      users.push({ username, role, iterations, salt, iv, encryptedToken });
    });
    const root = normalizeUsername(CONFIG.adminUsername || 'admin');
    if (!users.some(u => u.username === root)) {
      users.push({
        username: root,
        role: 'superadmin',
        iterations: Number(CONFIG.iterations || 250000),
        salt: String(CONFIG.salt || ''),
        iv: String(CONFIG.iv || ''),
        encryptedToken: String(CONFIG.encryptedToken || '')
      });
    }
    return {
      version: Number(logins?.version || base.version || 2),
      users,
      updatedAt: logins?.updatedAt || base.updatedAt,
      updatedBy: logins?.updatedBy || base.updatedBy
    };
  }

  function superadminUsernames() {
    return normalizeLogins(loginsData).users.filter(u => u.role === 'superadmin').map(u => u.username);
  }

  function normalizeAreaName(value) {
    return String(value || '').trim();
  }

  function defaultAreas() {
    return {
      areas: [...DEFAULT_AREAS],
      updatedAt: new Date().toISOString(),
      updatedBy: 'bootstrap'
    };
  }

  function normalizeAreas(payload) {
    const src = Array.isArray(payload?.areas) ? payload.areas : [];
    const areas = [];
    src.forEach(name => {
      const area = normalizeAreaName(name);
      if (!area) return;
      if (areas.includes(area)) return;
      areas.push(area);
    });
    return {
      areas: areas.length ? areas : [...DEFAULT_AREAS],
      updatedAt: payload?.updatedAt || new Date().toISOString(),
      updatedBy: payload?.updatedBy || 'superadmin'
    };
  }

  function headers(extra = {}) {
    const base = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra
    };
    if (token) base.Authorization = `Bearer ${token}`;
    return base;
  }

  async function stateContent(path, options = {}) {
    const res = await fetch(`https://api.github.com/repos/${STATE_OWNER}/${STATE_REPO}/contents/${path}`, {
      ...options,
      headers: headers(options.headers || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `GitHub API fejl ${res.status}`);
    return json;
  }

  async function repoContent(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}${
      method === 'GET' ? `?ref=${encodeURIComponent(CONFIG.branch || 'main')}` : ''
    }`;
    const res = await fetch(url, {
      ...options,
      headers: headers(options.headers || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `GitHub API fejl ${res.status}`);
    return json;
  }

  async function readJsonFile(path) {
    const file = await stateContent(`${path}?ref=${encodeURIComponent(STATE_BRANCH)}`);
    const encoded = String(file.content || '');
    let parsed = null;
    if (encoded) {
      try {
        parsed = JSON.parse(b64ToUtf8(encoded));
      } catch (_) {
        parsed = null;
      }
    }
    return { json: parsed, sha: file.sha };
  }

  async function writeJsonFile(path, obj, sha) {
    async function putFile(currentSha) {
      const body = { message: `Superadmin update ${path}`, content: utf8ToB64(`${JSON.stringify(obj, null, 2)}\n`), branch: STATE_BRANCH };
      if (currentSha) body.sha = currentSha;
      return stateContent(path, { method: 'PUT', body: JSON.stringify(body) });
    }

    let currentSha = sha;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!currentSha) {
        try {
          const existing = await stateContent(`${path}?ref=${encodeURIComponent(STATE_BRANCH)}`);
          currentSha = existing.sha;
        } catch (error) {
          if (!String(error?.message || '').includes('404')) throw error;
        }
      }
      try {
        const res = await putFile(currentSha);
        return res.content?.sha || null;
      } catch (error) {
        const message = String(error?.message || '');
        if (attempt < 3 && (message.includes('does not match') || message.includes('sha') || message.includes('conflict'))) {
          try {
            const existing = await stateContent(`${path}?ref=${encodeURIComponent(STATE_BRANCH)}`);
            currentSha = existing.sha;
            continue;
          } catch (_) {}
        }
        throw error;
      }
    }
    throw new Error('Failed to write JSON file after retries');
  }

  async function readRepoJsonFile(path) {
    const file = await repoContent(path);
    const encoded = String(file.content || '');
    let parsed = null;
    if (encoded) {
      try {
        parsed = JSON.parse(b64ToUtf8(encoded));
      } catch (_) {
        parsed = null;
      }
    }
    return { json: parsed, sha: file.sha };
  }

  async function writeRepoJsonFile(path, obj, sha) {
    async function putFile(currentSha) {
      const body = { message: `Superadmin update ${path}`, content: utf8ToB64(`${JSON.stringify(obj, null, 2)}\n`), branch: CONFIG.branch || 'main' };
      if (currentSha) body.sha = currentSha;
      return repoContent(path, { method: 'PUT', body: JSON.stringify(body) });
    }

    let currentSha = sha;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!currentSha) {
        try {
          const existing = await repoContent(path);
          currentSha = existing.sha;
        } catch (error) {
          const message = String(error?.message || '');
          if (!message.includes('404') && !message.includes('Not Found')) throw error;
        }
      }
      try {
        const res = await putFile(currentSha);
        return res.content?.sha || null;
      } catch (error) {
        const message = String(error?.message || '');
        if (attempt < 3 && (message.includes('does not match') || message.includes('sha') || message.includes('conflict'))) {
          try {
            const existing = await repoContent(path);
            currentSha = existing.sha;
            continue;
          } catch (_) {}
        }
        throw error;
      }
    }
    throw new Error('Failed to write JSON file after retries');
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('da-DK');
  }

  function formatUptime(seconds) {
    const s = Number(seconds || 0);
    if (!s) return '-';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}t ${m}m` : `${h}t ${m}m`;
  }

  const DAY_LABELS = { monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag', thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag' };

  function weekdayLabel(day) {
    return DAY_LABELS[day] || `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
  }

  function defaultSchedule() {
    return {
      enabled: true,
      days: {
        monday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        tuesday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        wednesday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        thursday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        friday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        saturday: { enabled: true, startTime: '10:00', endTime: '22:00' },
        sunday: { enabled: true, startTime: '10:00', endTime: '22:00' }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'superadmin'
    };
  }

  function normalizeSchedule(schedule) {
    const base = defaultSchedule();
    const out = { ...base, ...(schedule || {}) };
    out.days = { ...base.days };
    const src = schedule?.days || {};
    Object.keys(base.days).forEach(day => {
      const entry = src[day] || {};
      out.days[day] = {
        enabled: entry.enabled !== false,
        startTime: String(entry.startTime || base.days[day].startTime || '10:00').slice(0, 5),
        endTime: String(entry.endTime || base.days[day].endTime || '22:00').slice(0, 5)
      };
    });
    return out;
  }

  function buildScheduleMarkup(schedule) {
    const data = normalizeSchedule(schedule || scheduleData || defaultSchedule());
    const days = Object.keys(data.days);
    return days
      .map(
        day =>
          `<div class="schedule-day"><div class="schedule-day-head"><label class="schedule-day-name"><input type="checkbox" data-day="${day}" ${
            data.days[day].enabled !== false ? 'checked' : ''
          } /> ${weekdayLabel(day)}</label></div><div class="schedule-day-times"><label>Start<input type="time" data-day-start="${day}" value="${
            data.days[day].startTime || '10:00'
          }" /></label><label>Slut<input type="time" data-day-end="${day}" value="${data.days[day].endTime || '22:00'}" /></label></div></div>`
      )
      .join('');
  }

  function setScheduleForm(schedule) {
    const data = normalizeSchedule(schedule || scheduleData || defaultSchedule());
    if (els.scheduleEnabled) els.scheduleEnabled.checked = data.enabled !== false;
    if (els.scheduleDays) els.scheduleDays.innerHTML = buildScheduleMarkup(data);
    return data;
  }

  function renderSchedule(schedule) {
    const data = setScheduleForm(schedule || scheduleData || defaultSchedule());
    if (els.scheduleSummary) els.scheduleSummary.textContent = data.enabled === false ? 'Skærmen er deaktiveret.' : '';
    if (els.scheduleJson) els.scheduleJson.textContent = JSON.stringify(data, null, 2);
    return data;
  }

  async function refreshSchedule() {
    try {
      const file = await readJsonFile(SCHEDULE_PATH);
      scheduleData = normalizeSchedule(file.json);
      scheduleSha = file.sha;
      renderSchedule(scheduleData);
    } catch (error) {
      scheduleData = defaultSchedule();
      renderSchedule(scheduleData);
      msg(els.scheduleMessage, `Kunne ikke hente tidsplan: ${friendlyError(error)}`, true);
    }
  }

  async function saveSchedule() {
    try {
      msg(els.scheduleMessage, 'Gemmer tidsplan…');
      const days = {};
      els.scheduleDays.querySelectorAll('[data-day]').forEach(box => {
        const day = box.getAttribute('data-day');
        const start = els.scheduleDays.querySelector(`[data-day-start="${day}"]`)?.value || '10:00';
        const end = els.scheduleDays.querySelector(`[data-day-end="${day}"]`)?.value || '22:00';
        days[day] = { enabled: box.checked, startTime: start.slice(0, 5), endTime: end.slice(0, 5) };
      });
      const payload = { enabled: els.scheduleEnabled?.checked !== false, days, updatedAt: new Date().toISOString(), updatedBy: currentLoginUsername || 'superadmin' };
      scheduleSha = await writeJsonFile(SCHEDULE_PATH, payload, scheduleSha);
      scheduleData = payload;
      renderSchedule(scheduleData);
      msg(els.scheduleMessage, 'Tidsplan gemt');
      await sendCommand('reload-schedule');
    } catch (error) {
      msg(els.scheduleMessage, friendlyError(error), true);
    }
  }

  function setPill(text, cls) {
    els.onlinePill.textContent = text;
    els.onlinePill.className = `status-pill ${cls}`;
  }

  function renderStatus(status) {
    const lastSeenDate = status.lastSeen ? new Date(status.lastSeen) : null;
    const offline = !lastSeenDate || Date.now() - lastSeenDate.getTime() > OFFLINE_AFTER_MS;
    setPill(offline ? 'Offline' : 'Online', offline ? 'error' : 'ok');
    els.deviceTitle.textContent = status.deviceId || DEVICE_ID;
    els.lastSeen.textContent = formatDate(status.lastSeen);
    els.hostname.textContent = status.hostname || '-';
    els.uptime.textContent = formatUptime(status.uptimeSeconds);
    els.temperature.textContent = typeof status.temperatureC === 'number' ? `${status.temperatureC.toFixed(1)} °C` : '-';
    els.browser.textContent = status.browser || '-';
    const screenPower = String(status.screenPower || status.screenState || '').toLowerCase();
    els.screenPower.textContent = screenPower === 'on' ? 'Tændt' : screenPower === 'off' ? 'Slukket' : screenPower || '-';
    if (els.turnScreenOnButton) els.turnScreenOnButton.disabled = screenPower === 'on';
    if (els.turnScreenOffButton) els.turnScreenOffButton.disabled = screenPower === 'off';
    els.lastCommand.textContent = [status.lastCommand, status.lastCommandResult].filter(Boolean).join(' / ') || '-';
    msg(els.lastError, status.lastError || '', !!status.lastError);
    els.rawStatus.textContent = JSON.stringify(status, null, 2);
  }

  async function refreshStatus() {
    try {
      const { json } = await readJsonFile(STATUS_PATH);
      renderStatus(json || {});
    } catch (error) {
      setPill('Offline', 'error');
      msg(els.lastError, `Kunne ikke hente status fra ${STATE_REPO}: ${friendlyError(error)}`, true);
    }
  }

  function setCommandControlsDisabled(disabled) {
    [els.reloadPageButton, els.restartBrowserButton, els.turnScreenOnButton, els.turnScreenOffButton, els.rebootPiButton, els.refreshScheduleOnPiButton, els.saveScheduleButton]
      .filter(Boolean)
      .forEach(btn => {
        btn.disabled = disabled;
      });
  }

  function getCommandCooldownRemainingSeconds() {
    const remaining = Math.ceil((commandCooldownUntil - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  function canSendCommand() {
    const remaining = getCommandCooldownRemainingSeconds();
    if (remaining > 0) {
      msg(els.commandMessage, `Afvent venligst ${remaining} sekunder, før du forsøger ny kommando.`, true);
      return false;
    }
    return true;
  }

  async function sendCommand(command) {
    if (command === 'reboot-pi' && !confirm('Er du sikker på at du vil genstarte Raspberry Pi’en?')) return;
    if (command === 'restart-browser' && !confirm('Er du sikker på at du vil genstarte browseren?')) return;
    if (commandInFlight) {
      msg(els.commandMessage, 'En kommando er allerede undervejs. Vent et øjeblik.', true);
      return;
    }
    if (!canSendCommand()) return;
    commandInFlight = true;
    setCommandControlsDisabled(true);
    try {
      msg(els.commandMessage, `Sender kommando: ${command}…`);
      try {
        const existing = await readJsonFile(COMMAND_PATH);
        commandSha = existing.sha;
      } catch (_) {
        commandSha = null;
      }
      const now = new Date();
      const obj = {
        id: `${now.toISOString()}-${Math.random().toString(16).slice(2, 8)}`,
        deviceId: DEVICE_ID,
        command,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        createdBy: currentLoginUsername || 'superadmin'
      };
      commandSha = await writeJsonFile(COMMAND_PATH, obj, commandSha);
      commandCooldownUntil = Date.now() + 30000;
      msg(els.commandMessage, 'Kommando sendt. Status opdateres automatisk.');
      setTimeout(refreshStatus, 2000);
    } catch (error) {
      msg(els.commandMessage, friendlyError(error), true);
    } finally {
      commandInFlight = false;
      setCommandControlsDisabled(false);
    }
  }

  function renderLoginAdmin() {
    if (!els.loginList) return;
    const users = normalizeLogins(loginsData).users.sort((a, b) => a.username.localeCompare(b.username));
    els.loginList.innerHTML = users
      .map(user => {
        const canDelete = user.username !== normalizeUsername(CONFIG.adminUsername) && user.username !== currentLoginUsername;
        return `<div class="schedule-day">
          <p class="status-label">${user.username}</p>
          <p class="status-value">${user.role === 'superadmin' ? 'Superadmin (begge paneler)' : 'Admin (/admin)'}</p>
          <label>Nyt password<input type="password" data-login-password="${user.username}" autocomplete="new-password" /></label>
          <label>Rolle<select data-login-role="${user.username}">
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option>
          </select></label>
          <div class="actions">
            <button type="button" class="secondary" data-save-login="${user.username}">Gem ændringer</button>
            <button type="button" class="danger" data-remove-login="${user.username}" ${canDelete ? '' : 'disabled'}>Fjern login</button>
          </div>
        </div>`;
      })
      .join('');
    els.loginList.querySelectorAll('[data-save-login]').forEach(btn => {
      btn.onclick = () => updateLogin(btn.getAttribute('data-save-login') || '');
    });
    els.loginList.querySelectorAll('[data-remove-login]').forEach(btn => {
      btn.onclick = () => removeLogin(btn.getAttribute('data-remove-login') || '');
    });
  }

  async function refreshLogins() {
    try {
      const file = await readRepoJsonFile(LOGINS_PATH);
      loginsData = normalizeLogins(file.json);
      loginsSha = file.sha;
      renderLoginAdmin();
    } catch (error) {
      loginsData = defaultLogins();
      loginsSha = null;
      renderLoginAdmin();
      const message = String(error?.message || '');
      if (!message.includes('404') && !message.includes('Not Found')) {
        msg(els.loginAdminMessage, `Kunne ikke hente logins: ${friendlyError(error)}`, true);
      } else {
        msg(els.loginAdminMessage, '');
      }
    }
  }

  async function saveLogins() {
    const payload = normalizeLogins(loginsData);
    payload.updatedAt = new Date().toISOString();
    payload.updatedBy = currentLoginUsername || 'superadmin';
    loginsSha = await writeRepoJsonFile(LOGINS_PATH, payload, loginsSha);
    loginsData = payload;
    renderLoginAdmin();
  }

  async function addLogin() {
    try {
      const username = normalizeUsername(els.newLoginUsername?.value);
      const password = String(els.newLoginPassword?.value || '').trim();
      const role = normalizeRole(els.newLoginRole?.value);
      if (!username) throw new Error('Brugernavn mangler.');
      if (!password) throw new Error('Password mangler.');
      const data = normalizeLogins(loginsData);
      if (data.users.some(u => u.username === username)) throw new Error('Brugernavnet findes allerede.');
      const cred = await encryptTokenForPassword(token, password, Number(CONFIG.iterations || 250000));
      data.users.push({ username, role, ...cred });
      loginsData = data;
      await saveLogins();
      els.newLoginUsername.value = '';
      els.newLoginPassword.value = '';
      msg(els.loginAdminMessage, 'Login oprettet.');
    } catch (error) {
      msg(els.loginAdminMessage, friendlyError(error), true);
    }
  }

  async function updateLogin(username) {
    try {
      const key = normalizeUsername(username);
      if (!key) throw new Error('Ugyldigt brugernavn.');
      const roleInput = els.loginList?.querySelector(`[data-login-role="${key}"]`);
      const passInput = els.loginList?.querySelector(`[data-login-password="${key}"]`);
      const newRole = normalizeRole(roleInput?.value);
      const newPassword = String(passInput?.value || '').trim();
      const data = normalizeLogins(loginsData);
      const user = data.users.find(u => u.username === key);
      if (!user) throw new Error('Login blev ikke fundet.');
      user.role = key === normalizeUsername(CONFIG.adminUsername) ? 'superadmin' : newRole;
      if (newPassword) {
        const cred = await encryptTokenForPassword(token, newPassword, Number(CONFIG.iterations || 250000));
        user.iterations = cred.iterations;
        user.salt = cred.salt;
        user.iv = cred.iv;
        user.encryptedToken = cred.encryptedToken;
      }
      loginsData = data;
      await saveLogins();
      if (passInput) passInput.value = '';
      msg(els.loginAdminMessage, 'Login opdateret.');
    } catch (error) {
      msg(els.loginAdminMessage, friendlyError(error), true);
    }
  }

  async function removeLogin(username) {
    try {
      const key = normalizeUsername(username);
      if (!key) throw new Error('Ugyldigt brugernavn.');
      if (key === normalizeUsername(CONFIG.adminUsername)) throw new Error('Primær superadmin kan ikke slettes.');
      if (key === currentLoginUsername) throw new Error('Du kan ikke slette din egen aktive login.');
      if (!confirm(`Fjern login "${key}"?`)) return;
      const data = normalizeLogins(loginsData);
      data.users = data.users.filter(u => u.username !== key);
      if (!data.users.length) throw new Error('Der skal være mindst ét login.');
      loginsData = data;
      await saveLogins();
      msg(els.loginAdminMessage, 'Login fjernet.');
    } catch (error) {
      msg(els.loginAdminMessage, friendlyError(error), true);
    }
  }

  function renderAreasAdmin() {
    if (!els.areaList) return;
    const areas = normalizeAreas(areasData).areas;
    els.areaList.innerHTML = areas
      .map(
        area => `<div class="schedule-day">
          <p class="status-value">${area}</p>
          <div class="actions">
            <button type="button" class="danger" data-remove-area="${area.replace(/"/g, '&quot;')}">Fjern område</button>
          </div>
        </div>`
      )
      .join('');
    els.areaList.querySelectorAll('[data-remove-area]').forEach(btn => {
      btn.onclick = () => removeArea(btn.getAttribute('data-remove-area') || '');
    });
  }

  async function refreshAreas() {
    try {
      const file = await readRepoJsonFile(AREAS_PATH);
      areasData = normalizeAreas(file.json);
      areasSha = file.sha;
      renderAreasAdmin();
    } catch (error) {
      const message = String(error?.message || '');
      areasData = defaultAreas();
      areasSha = null;
      renderAreasAdmin();
      if (!message.includes('404') && !message.includes('Not Found')) {
        msg(els.areaAdminMessage, `Kunne ikke hente områder: ${friendlyError(error)}`, true);
      } else {
        msg(els.areaAdminMessage, '');
      }
    }
  }

  async function saveAreas() {
    const payload = normalizeAreas(areasData);
    payload.updatedAt = new Date().toISOString();
    payload.updatedBy = currentLoginUsername || 'superadmin';
    areasSha = await writeRepoJsonFile(AREAS_PATH, payload, areasSha);
    areasData = payload;
    renderAreasAdmin();
  }

  async function addArea() {
    try {
      const area = normalizeAreaName(els.newAreaName?.value);
      if (!area) throw new Error('Område mangler.');
      const payload = normalizeAreas(areasData);
      if (payload.areas.includes(area)) throw new Error('Område findes allerede.');
      payload.areas.push(area);
      areasData = payload;
      await saveAreas();
      els.newAreaName.value = '';
      msg(els.areaAdminMessage, 'Område tilføjet.');
    } catch (error) {
      msg(els.areaAdminMessage, friendlyError(error), true);
    }
  }

  async function removeArea(areaName) {
    try {
      const area = normalizeAreaName(areaName);
      if (!area) throw new Error('Ugyldigt område.');
      const payload = normalizeAreas(areasData);
      payload.areas = payload.areas.filter(name => name !== area);
      if (!payload.areas.length) throw new Error('Der skal være mindst ét område.');
      areasData = payload;
      await saveAreas();
      msg(els.areaAdminMessage, 'Område fjernet.');
    } catch (error) {
      msg(els.areaAdminMessage, friendlyError(error), true);
    }
  }

  async function login() {
    try {
      msg(els.loginMessage, 'Logger ind…');
      els.loginButton.disabled = true;
      await refreshLogins();
      const enteredUsername = normalizeUsername(els.username.value);
      const enteredPassword = String(els.password.value || '');
      const user = normalizeLogins(loginsData).users.find(u => u.username === enteredUsername);
      if (!user) throw new Error('Forkert brugernavn eller password.');
      if (!superadminUsernames().includes(enteredUsername)) throw new Error('Kun superadmin kan logge ind her.');
      token = await decryptWithCredential(enteredPassword, user);
      currentLoginUsername = enteredUsername;
      els.loginPanel.classList.add('hidden');
      els.superPanel.classList.remove('hidden');
      els.logoutButton.classList.remove('hidden');
      els.password.value = '';
      msg(els.loginMessage, '');
      await Promise.all([refreshStatus(), refreshSchedule(), refreshLogins(), refreshAreas()]);
      statusTimer = setInterval(refreshStatus, POLL_MS);
    } catch (error) {
      token = null;
      msg(els.loginMessage, friendlyError(error), true);
    } finally {
      els.loginButton.disabled = false;
    }
  }

  function init() {
    msg(els.loginMessage, 'Klar til login.');
    els.loginButton.onclick = login;
    els.password?.addEventListener('keydown', e => {
      if (e.key === 'Enter') login();
    });
    els.logoutButton.onclick = () => location.reload();
    els.reloadPageButton.onclick = () => sendCommand('reload-page');
    els.restartBrowserButton.onclick = () => sendCommand('restart-browser');
    els.turnScreenOnButton.onclick = () => sendCommand('screen-on');
    els.turnScreenOffButton.onclick = () => sendCommand('screen-off');
    els.rebootPiButton.onclick = () => sendCommand('reboot-pi');
    els.saveScheduleButton.onclick = () => saveSchedule();
    els.refreshScheduleButton.onclick = () => refreshSchedule();
    els.refreshScheduleOnPiButton.onclick = () => sendCommand('reload-schedule');
    els.addLoginButton.onclick = () => addLogin();
    els.addAreaButton.onclick = () => addArea();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
