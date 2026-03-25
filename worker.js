/**
 * RAG Command Center — Cloudflare Worker API
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
        const lastRun = await env.RG_DATA.get('compile:last_run');
        return json({ status: 'ok', service: 'rag-command-center-api', ts: Date.now(), last_compile: lastRun });
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

      /* GET /api/compile — auto-scrape public sources, score, store as signals */
      if (request.method === 'GET' && path === '/api/compile') {
        return await compilePublicSources(env);
      }

      /* GET /api/signals — list compiled signals */
      if (request.method === 'GET' && path === '/api/signals') {
        return await listSignals(env);
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
   AUTO-COMPILE — scrape public sources, score intent, store signals
   Sources: Victoria Open Data, Used Victoria, Reddit (via old.reddit)
   Runs on cron (scheduled) AND on-demand via GET /api/compile
   ═══════════════════════════════════════════ */

const VIC_HOODS = ['oak bay','saanich','langford','colwood','esquimalt','sooke','sidney','view royal','fairfield','james bay','fernwood','rockland','gonzales','jubilee','burnside','gorge','tillicum','hillside','quadra','vic west','north park','harris green','cadboro bay','gordon head','brentwood bay','cordova bay','bear mountain'];
const BUY_KW = ['looking for a home','looking for a house','looking for a condo','looking for a place','want to buy a home','want to buy a house','house hunting','pre-approved','mortgage','first time buyer','first-time buyer','moving to victoria','relocating to victoria','buying a home','buying a house','looking to buy','budget for a home','down payment'];
const SELL_KW = ['selling my home','selling my house','selling my condo','for sale by owner','fsbo','just listed','price reduced','open house','listing agent','selling property','want to sell','need to sell','thinking of selling','home for sale','house for sale'];
const RE_REQUIRED = ['house','home','condo','apartment','property','real estate','mortgage','realtor','rent','lease','bedroom','sqft','square feet','listing','mls','strata','townhouse','duplex','lot','acre','land','zoning','assessed','renovate','flip','investment property'];

/* Stale threshold — signals older than this are marked stale */
const STALE_DAYS = 14;
function isStaleSignal(compiledAt) {
  if (!compiledAt) return true;
  return (Date.now() - new Date(compiledAt).getTime()) > STALE_DAYS * 86400000;
}

function scorePost(text, author) {
  const lower = (text || '').toLowerCase();
  if (!lower || lower.length < 20) return null;
  /* Must contain at least one real estate keyword to qualify */
  const hasRE = RE_REQUIRED.some(w => lower.includes(w));
  if (!hasRE) return null;
  const buyHits = BUY_KW.filter(w => lower.includes(w)).length;
  const sellHits = SELL_KW.filter(w => lower.includes(w)).length;
  const intent = buyHits > sellHits ? 'buying' : (sellHits > 0 ? 'selling' : 'asking');
  const hoods = VIC_HOODS.filter(h => lower.includes(h));
  const budgetMatch = text.match(/\$\s*([\d,.]+)/); 
  const budget = budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, '')) : null;
  const bedMatch = text.match(/(\d+)\s*(?:bed|br|bedroom)/i);
  const beds = bedMatch ? parseInt(bedMatch[1]) : null;
  let score = 10;
  if (intent === 'buying') score += 25;
  else if (intent === 'selling') score += 20;
  if (hoods.length) score += 15;
  if (budget && budget > 100000) score += 15;
  if (beds) score += 5;
  if (lower.includes('pre-approved') || lower.includes('preapproved') || lower.includes('mortgage')) score += 15;
  if (lower.includes('asap') || lower.includes('urgent') || lower.includes('relocat')) score += 10;
  if (text.length > 200) score += 5;
  /* Credibility score based on available signals */
  let credibility = 50;
  if (author && author !== '[deleted]') credibility += 10;
  if (text.length > 300) credibility += 10;
  if (hoods.length) credibility += 15;
  if (budget && budget > 100000) credibility += 15;
  if (beds) credibility += 5;
  if (lower.includes('we ') || lower.includes('my wife') || lower.includes('my husband') || lower.includes('our family')) credibility += 10;
  if (lower.includes('pre-approved') || lower.includes('mortgage approved')) credibility += 15;
  credibility = Math.min(100, credibility);
  return { intent, score: Math.min(100, score), credibility, neighbourhoods: hoods, budget, beds, text: text.slice(0, 500), author: author || 'anonymous' };
}

async function compilePublicSources(env) {
  const results = [];
  
  // 1. Reddit r/VictoriaBC via old.reddit (less aggressive blocking)
  try {
    const redditRes = await fetch('https://old.reddit.com/r/VictoriaBC/search.json?q=house+OR+condo+OR+rent+OR+buy+OR+realtor&restrict_sr=on&sort=new&limit=25&t=week', {
      headers: { 'User-Agent': 'RAGCommandCenter/1.0 (real estate intelligence)' }
    });
    if (redditRes.ok) {
      const data = await redditRes.json();
      const posts = data?.data?.children || [];
      for (const p of posts) {
        const d = p.data;
        const scored = scorePost(d.title + ' ' + (d.selftext || ''), d.author);
        if (scored && scored.score >= 30) {
          results.push({ ...scored, source: 'reddit', url: 'https://reddit.com' + d.permalink, author: d.author, created: d.created_utc });
        }
      }
    }
  } catch (e) { /* reddit failed, continue */ }
  
  // 2. Reddit r/canadahousing Victoria mentions
  try {
    const chRes = await fetch('https://old.reddit.com/r/canadahousing/search.json?q=victoria+BC&restrict_sr=on&sort=new&limit=10&t=week', {
      headers: { 'User-Agent': 'RAGCommandCenter/1.0 (real estate intelligence)' }
    });
    if (chRes.ok) {
      const data = await chRes.json();
      const posts = data?.data?.children || [];
      for (const p of posts) {
        const d = p.data;
        const scored = scorePost(d.title + ' ' + (d.selftext || ''), d.author);
        if (scored && scored.score >= 30) {
          results.push({ ...scored, source: 'reddit_canadahousing', url: 'https://reddit.com' + d.permalink, author: d.author, created: d.created_utc });
        }
      }
    }
  } catch (e) { /* continue */ }
  
  // 3. Victoria Open Data - building permits (renovation signal = investor/flipper lead)
  try {
    const odRes = await fetch('https://opendata.victoria.ca/api/v2/search?q=building+permit&num=5');
    if (odRes.ok) {
      const data = await odRes.json();
      if (data.results) {
        for (const r of data.results.slice(0, 3)) {
          results.push({ intent: 'data_signal', score: 25, source: 'victoria_opendata', text: r.title || 'Victoria open data', url: r.url || '', neighbourhoods: [], budget: null, beds: null });
        }
      }
    }
  } catch (e) { /* continue */ }
  
  /* ── URL-based deduplication ──
     Load existing signal URLs from KV to prevent storing the same post twice.
     Possible duplicates (same author + similar text but different URL) are
     flagged with duplicate_of instead of being silently dropped.            */
  const existing = await loadIndex(env, 'signal_index');
  const existingSignals = (await Promise.all(
    existing.slice(0, 200).map(id => env.RG_DATA.get('signal:' + id).then(v => v ? JSON.parse(v) : null))
  )).filter(Boolean);
  const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));
  const existingTextKeys = new Map(existingSignals.map(s => [makeTextKey(s.text || s.raw_text || ''), s.id]));

  const newSignals = [];
  let duplicateCount = 0;
  for (const r of results) {
    /* Exact URL match → skip entirely (already stored) */
    if (r.url && existingUrls.has(r.url)) { duplicateCount++; continue; }

    /* Fuzzy text match → store but flag as possible duplicate with branch link */
    const tKey = makeTextKey(r.text || '');
    const possibleDupeOf = existingTextKeys.get(tKey) || null;

    const id = 'sig_' + genId();
    const signal = {
      ...r, id, compiled_at: new Date().toISOString(),
      freshness: 'fresh',
      ...(possibleDupeOf ? { duplicate_of: possibleDupeOf, duplicate_flag: 'possible' } : {})
    };
    await env.RG_DATA.put('signal:' + id, JSON.stringify(signal), { expirationTtl: 2592000 });
    newSignals.push(id);
    if (r.url) existingUrls.add(r.url);
    existingTextKeys.set(tKey, id);
  }

  const allIds = [...newSignals, ...existing].slice(0, 500);
  await env.RG_DATA.put('signal_index', JSON.stringify(allIds));

  /* Bump last compile timestamp for health monitoring */
  await env.RG_DATA.put('compile:last_run', new Date().toISOString());
  
  return json({
    success: true,
    compiled: newSignals.length,
    duplicates_skipped: duplicateCount,
    sources: ['reddit_victoriabc', 'reddit_canadahousing', 'victoria_opendata'],
    signals: results.filter(r => !r.url || !existingUrls.has(r.url) || newSignals.some(() => true))
  });
}

/* Text key for fuzzy dedup — first 80 chars normalised */
function makeTextKey(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

async function listSignals(env) {
  const ids = await loadIndex(env, 'signal_index');
  const limit = 50;
  const items = (await Promise.all(
    ids.slice(0, limit).map(id => env.RG_DATA.get('signal:' + id).then(v => v ? JSON.parse(v) : null))
  )).filter(Boolean);

  /* Tag stale signals on read */
  for (const s of items) {
    s.freshness = isStaleSignal(s.compiled_at) ? 'stale' : 'fresh';
  }

  const lastRun = await env.RG_DATA.get('compile:last_run');
  return json({ success: true, total: ids.length, last_compile: lastRun, signals: items });
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
  const data = new TextEncoder().encode(ip + ':rag-salt-v1');
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

/* ═══════════════════════════════════════════
   SCHEDULED HANDLER — Cron-triggered auto-compile
   Runs every hour to pull new signals automatically.
   No duplicates: compilePublicSources() deduplicates by URL.
   ═══════════════════════════════════════════ */
export async function scheduled(event, env, ctx) {
  ctx.waitUntil(compilePublicSources(env));
}
