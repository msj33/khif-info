const OWNER = 'msj33';
const REPO = 'khif-info';
const ISSUE_LABEL = 'indsendelse';
const DEFAULT_AREAS = ['KHIF - Info', 'Fodbold', 'Badminton', 'Gymnastik', 'Tennis', 'Volleyball', 'Fitness', 'Andet'];
const ALLOWED_ORIGINS = new Set(['https://msj33.github.io']);

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    }
  });
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API error ${response.status}`);
  return body;
}

function getAreas() {
  return DEFAULT_AREAS;
}

async function ensureIssueLabel(token) {
  const path = `/repos/${OWNER}/${REPO}/labels/${encodeURIComponent(ISSUE_LABEL)}`;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`Could not check issue label (${response.status})`);
  try {
    await githubRequest(`/repos/${OWNER}/${REPO}/labels`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ISSUE_LABEL, color: '1d76db', description: 'Anonym indsendt nyhed til behandling' })
    });
  } catch (error) {
    const retry = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!retry.ok) throw error;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/areas') {
      return jsonResponse({ areas: getAreas() }, 200, origin);
    }
    if (request.method !== 'POST' || url.pathname !== '/submit') {
      return jsonResponse({ error: 'Endpoint ikke fundet.' }, 404, origin);
    }
    if (!env.INDSEND_PAT_TOKEN) return jsonResponse({ error: 'Indsendelse er ikke konfigureret.' }, 503, origin);
    if (Number(request.headers.get('Content-Length') || 0) > 4096) {
      return jsonResponse({ error: 'Indsendelsen er for stor.' }, 413, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'Ugyldige data.' }, 400, origin);
    }

    if (typeof payload?.website === 'string' && payload.website.trim()) {
      return jsonResponse({ ok: true }, 200, origin);
    }
    const title = String(payload?.title || '').trim();
    const text = String(payload?.text || '').trim();
    const area = String(payload?.area || '').trim();
    if (!title || title.length > 48 || !text || text.length > 200) {
      return jsonResponse({ error: 'Udfyld titel (maks. 48 tegn) og tekst (maks. 200 tegn).' }, 400, origin);
    }

    try {
      const areas = getAreas();
      if (!areas.includes(area)) return jsonResponse({ error: 'Vælg et gyldigt område.' }, 400, origin);
      await ensureIssueLabel(env.INDSEND_PAT_TOKEN);
      const issue = await githubRequest(`/repos/${OWNER}/${REPO}/issues`, env.INDSEND_PAT_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Indsendelse] ${title}`,
          body: `Område: ${area}\n\n${text}\n\n---\nIndsendt anonymt via KHIF Info.`,
          labels: [ISSUE_LABEL]
        })
      });
      return jsonResponse({ ok: true, number: issue.number }, 201, origin);
    } catch {
      return jsonResponse({ error: 'Nyheden kunne ikke indsendes lige nu. Prøv igen senere.' }, 502, origin);
    }
  }
};
