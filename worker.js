/**
 * R&G Command Center — Cloudflare Worker API
 *
 * Endpoints:
 *   GET  /api/health              → service health check
 *   GET  /api/stats               → global platform statistics
 *   POST /api/inquiries           → submit a public inquiry
 *   GET  /api/inquiries           → list stored inquiries (internal)
 *   GET  /api/inquiries/:id       → single inquiry detail
 *   PUT  /api/inquiries/:id       → update inquiry status
 *   POST /api/events              → collect analytics events
 *   POST /api/proxy               → CORS proxy for external data feeds
 *
 * Storage: Cloudflare Workers KV (binding: RG_DATA)
 * Rate limiting: progressive per-IP
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const RATE_LIMITS = {
  inquiry:  { perMinute: 5,  perHour: 30,  perDay: 100 },
  fetch:    { perMinute: 60, perHour: 600, perDay: 3000 },
  events:   { perMinute: 30, perHour: 500, perDay: 5000 },
  proxy:    { perMinute: 10, perHour: 60,  perDay: 200 },
};

const TIMEOUT_SECONDS = { 1: 60, 2: 300, 3: 900, 4: 3600, 5: 7200 };

/* ───────── entry ───────── */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;
    const ip   = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      /* health — no rate limit */
      if (path === '/api/health') {
        return json({ status: 'ok', service: 'rg-command-center-api', ts: Date.now() });
      }

      /* global stats — no rate limit */
      if (request.method === 'GET' && path === '/api/stats') {
        return await getStats(env);
      }

      /* rate-limited endpoints */
      const action = resolveAction(request.method, path);
      const rl = await checkRateLimit(ip, action, env);
      if (!rl.allowed) {
        return json({ error: 'rate_limited', message: rl.message, retryAfter: rl.retryAfter }, 429,
          { 'Retry-After': String(rl.retryAfter) });
      }

      /* POST /api/inquiries — create */
      if (request.method === 'POST' && path === '/api/inquiries') {
        return await createInquiry(await request.json(), ip, env);
      }

      /* GET /api/inquiries — list */
      if (request.method === 'GET' && path === '/api/inquiries') {
        return await listInquiries(url, env);
      }

      /* GET /api/inquiries/:id */
      if (request.method === 'GET' && path.startsWith('/api/inquiries/')) {
        return await getInquiry(path.split('/').pop(), env);
      }

      /* PUT /api/inquiries/:id — update status */
      if (request.method === 'PUT' && path.startsWith('/api/inquiries/')) {
        return await updateInquiry(path.split('/').pop(), await request.json(), env);
      }

      /* POST /api/events — analytics */
      if (request.method === 'POST' && path === '/api/events') {
        return await collectEvent(await request.json(), ip, env);
      }

      /* POST /api/proxy — CORS proxy for external data feeds */
      if (request.method === 'POST' && path === '/api/proxy') {
        return await proxyFeed(await request.json(), env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500);
    }
  },
};

/* ═══════════════════════════════════════════
   INQUIRIES
   ═══════════════════════════════════════════ */

async function createInquiry(body, ip, env) {
  if (!body.name || !body.email) {
    return json({ error: 'name and email are required' }, 400);
  }

  const id = genId();
  const inquiry = {
    id,
    name:        String(body.name || '').slice(0, 200),
    email:       String(body.email || '').slice(0, 200),
    phone:       String(body.phone || '').slice(0, 40),
    intent:      String(body.intent || 'inquiry').slice(0, 100),
    market:      String(body.market || '').slice(0, 100),
    budget:      String(body.budget || '').slice(0, 100),
    timeline:    String(body.timeline || '').slice(0, 100),
    notes:       String(body.notes || '').slice(0, 2000),
    listing_id:  String(body.listing_id || 'general').slice(0, 80),
    source:      String(body.source || 'public_website').slice(0, 80),
    branch_hint: String(body.branch_hint || 'general_queue').slice(0, 80),
    status:      'new',
    ip_hash:     await hashIP(ip),
    created_at:  new Date().toISOString(),
  };

  /* store inquiry — 180 day TTL */
  await env.RG_DATA.put(`inquiry:${id}`, JSON.stringify(inquiry), { expirationTtl: 15552000 });

  /* append to index for listing */
  await appendToIndex(env, 'inquiry_index', id);

  /* bump global stat */
  await bumpStat(env, 'inquiries_total');

  return json({ success: true, id }, 201);
}

async function listInquiries(url, env) {
  const ids = await loadIndex(env, 'inquiry_index');
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const slice = ids.slice(offset, offset + limit);
  const items = (await Promise.all(
    slice.map(id => env.RG_DATA.get(`inquiry:${id}`).then(v => v ? JSON.parse(v) : null))
  )).filter(Boolean);

  return json({ success: true, total: ids.length, offset, items });
}

async function getInquiry(id, env) {
  const raw = await env.RG_DATA.get(`inquiry:${id}`);
  if (!raw) return json({ error: 'not_found' }, 404);
  return json({ success: true, data: JSON.parse(raw) });
}

async function updateInquiry(id, body, env) {
  const raw = await env.RG_DATA.get(`inquiry:${id}`);
  if (!raw) return json({ error: 'not_found' }, 404);

  const inquiry = JSON.parse(raw);
  if (body.status) inquiry.status = String(body.status).slice(0, 40);
  if (body.notes !== undefined) inquiry.notes = String(body.notes).slice(0, 2000);
  inquiry.updated_at = new Date().toISOString();

  await env.RG_DATA.put(`inquiry:${id}`, JSON.stringify(inquiry), { expirationTtl: 15552000 });
  return json({ success: true, message: 'updated' });
}

/* ═══════════════════════════════════════════
   ANALYTICS EVENTS
   ═══════════════════════════════════════════ */

async function collectEvent(body, ip, env) {
  const allowed = ['pageview', 'search', 'filter', 'listing_view', 'inquiry_start', 'inquiry_submit', 'map_view'];
  if (!body.type || !allowed.includes(body.type)) {
    return json({ error: 'invalid event type' }, 400);
  }

  const key = `event:${body.type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await env.RG_DATA.put(key, JSON.stringify({
    ts: Date.now(),
    type: body.type,
    ip_hash: await hashIP(ip),
    page: String(body.page || '').slice(0, 200),
    payload: body.payload || {},
  }), { expirationTtl: 2592000 }); /* 30 day TTL */

  const dayKey = `eventcount:${todayKey()}`;
  await increment(env, dayKey, 172800);

  return json({ ok: true });
}

/* ═══════════════════════════════════════════
   CORS PROXY — for external listing feeds
   ═══════════════════════════════════════════ */

async function proxyFeed(body, env) {
  if (!body.url) return json({ error: 'url required' }, 400);

  /* basic allow-list — only JSON endpoints */
  let target;
  try { target = new URL(body.url); } catch { return json({ error: 'invalid url' }, 400); }
  if (!['http:', 'https:'].includes(target.protocol)) return json({ error: 'invalid protocol' }, 400);

  const headers = {};
  if (body.auth_header && body.auth_value) {
    headers[body.auth_header] = body.auth_value;
  }

  const res = await fetch(target.toString(), {
    method: body.method || 'GET',
    headers: { 'Accept': 'application/json', ...headers },
  });

  if (!res.ok) {
    return json({ error: `upstream ${res.status}`, status: res.status }, 502);
  }

  const data = await res.json();
  return json({ success: true, data });
}

/* ═══════════════════════════════════════════
   STATS
   ═══════════════════════════════════════════ */

async function getStats(env) {
  const raw = await env.RG_DATA.get('global:stats');
  const stats = raw ? JSON.parse(raw) : { inquiries_total: 0, events_today: 0, last_updated: null };

  /* add today's event count */
  const dayCount = await env.RG_DATA.get(`eventcount:${todayKey()}`);
  stats.events_today = dayCount ? parseInt(dayCount) : 0;

  return json({ success: true, stats });
}

async function bumpStat(env, field) {
  const raw = await env.RG_DATA.get('global:stats');
  const stats = raw ? JSON.parse(raw) : { inquiries_total: 0 };
  stats[field] = (stats[field] || 0) + 1;
  stats.last_updated = new Date().toISOString();
  await env.RG_DATA.put('global:stats', JSON.stringify(stats));
}

/* ═══════════════════════════════════════════
   RATE LIMITING
   ═══════════════════════════════════════════ */

function resolveAction(method, path) {
  if (method === 'POST' && path === '/api/inquiries') return 'inquiry';
  if (method === 'POST' && path === '/api/events')    return 'events';
  if (method === 'POST' && path === '/api/proxy')      return 'proxy';
  return 'fetch';
}

async function checkRateLimit(ip, action, env) {
  /* check timeout */
  const toRaw = await env.RG_DATA.get(`timeout:${ip}`);
  if (toRaw) {
    const to = JSON.parse(toRaw);
    if (Date.now() < to.until) {
      const left = Math.ceil((to.until - Date.now()) / 1000);
      return { allowed: false, message: `Rate limited. Try again in ${fmtDur(left)}.`, retryAfter: left };
    }
    await env.RG_DATA.delete(`timeout:${ip}`);
  }

  const limits = RATE_LIMITS[action] || RATE_LIMITS.fetch;

  const mKey = `rl:${ip}:${action}:m:${minuteKey()}`;
  if (await increment(env, mKey, 60) > limits.perMinute) return await applyTimeout(ip, env);

  const hKey = `rl:${ip}:${action}:h:${hourKey()}`;
  if (await increment(env, hKey, 3600) > limits.perHour) return await applyTimeout(ip, env);

  const dKey = `rl:${ip}:${action}:d:${todayKey()}`;
  if (await increment(env, dKey, 86400) > limits.perDay) return await applyTimeout(ip, env);

  return { allowed: true };
}

async function applyTimeout(ip, env) {
  const vKey = `violations:${ip}`;
  const vRaw = await env.RG_DATA.get(vKey);
  const v = vRaw ? JSON.parse(vRaw) : { count: 0 };
  v.count += 1;
  await env.RG_DATA.put(vKey, JSON.stringify(v), { expirationTtl: 604800 });

  const secs = TIMEOUT_SECONDS[Math.min(v.count, 5)];
  await env.RG_DATA.put(`timeout:${ip}`, JSON.stringify({ until: Date.now() + secs * 1000, violationCount: v.count }), { expirationTtl: secs });

  return { allowed: false, message: `Rate limit exceeded (violation #${v.count}). Wait ${fmtDur(secs)}.`, retryAfter: secs };
}

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

async function increment(env, key, ttl) {
  const cur = await env.RG_DATA.get(key);
  const n = cur ? parseInt(cur) + 1 : 1;
  await env.RG_DATA.put(key, String(n), { expirationTtl: ttl });
  return n;
}

async function appendToIndex(env, indexKey, id) {
  const raw = await env.RG_DATA.get(indexKey);
  const ids = raw ? JSON.parse(raw) : [];
  ids.unshift(id);
  if (ids.length > 5000) ids.length = 5000;
  await env.RG_DATA.put(indexKey, JSON.stringify(ids));
}

async function loadIndex(env, indexKey) {
  const raw = await env.RG_DATA.get(indexKey);
  return raw ? JSON.parse(raw) : [];
}

async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + ':rg-salt-v1');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function minuteKey() { return Math.floor(Date.now() / 60000); }
function hourKey()   { return Math.floor(Date.now() / 3600000); }
function todayKey()  { return Math.floor(Date.now() / 86400000); }
function fmtDur(s)   { return s < 60 ? `${s}s` : s < 3600 ? `${Math.ceil(s / 60)}m` : `${Math.ceil(s / 3600)}h`; }

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}
