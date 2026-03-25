
window.GRR = (function(){
  const KEY = 'gr_v4_state';
  const PIPELINE_KEY = 'grr_realty_pipeline_v1';
  const DEFAULTS = {
    inquiries: [], internalNotes: {}, releasedIds: [], exportedAt: null, graceBypassUntil: 1000, sourceTestNotes: []
  };
  const EMPTY_PIPELINE = {
    updated_at: null,
    raw: { source_a: [], source_b: [], manual_uploads: [] },
    internal: { canonical_listings: [], source_conflicts: [], release_queue: [], source_runs: { runs: [] }, leads: [] },
    public: { released_listings: [], directory_index: { generated_at:null, grace_bypass_until_listing_count:1000, provinces:[] }, release_manifest: {} }
  };
  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
  function mergePipeline(base, incoming){
    const next = clone(base);
    if(!incoming || typeof incoming !== 'object') return next;
    next.updated_at = incoming.updated_at || base.updated_at;
    next.raw = {
      source_a: Array.isArray(incoming.raw?.source_a) ? incoming.raw.source_a : base.raw.source_a,
      source_b: Array.isArray(incoming.raw?.source_b) ? incoming.raw.source_b : base.raw.source_b,
      manual_uploads: Array.isArray(incoming.raw?.manual_uploads) ? incoming.raw.manual_uploads : base.raw.manual_uploads
    };
    next.internal = {
      canonical_listings: Array.isArray(incoming.internal?.canonical_listings) ? incoming.internal.canonical_listings : base.internal.canonical_listings,
      source_conflicts: Array.isArray(incoming.internal?.source_conflicts) ? incoming.internal.source_conflicts : base.internal.source_conflicts,
      release_queue: Array.isArray(incoming.internal?.release_queue) ? incoming.internal.release_queue : base.internal.release_queue,
      source_runs: (incoming.internal?.source_runs && Array.isArray(incoming.internal.source_runs.runs)) ? incoming.internal.source_runs : base.internal.source_runs,
      leads: Array.isArray(incoming.internal?.leads) ? incoming.internal.leads : base.internal.leads
    };
    next.public = {
      released_listings: Array.isArray(incoming.public?.released_listings) ? incoming.public.released_listings : base.public.released_listings,
      directory_index: (incoming.public?.directory_index && Array.isArray(incoming.public.directory_index.provinces)) ? incoming.public.directory_index : base.public.directory_index,
      release_manifest: (incoming.public?.release_manifest && typeof incoming.public.release_manifest === 'object') ? incoming.public.release_manifest : base.public.release_manifest
    };
    return next;
  }
  function loadState(){ try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY)||'{}')); } catch(e){ return clone(DEFAULTS);} }
  function saveState(state){ localStorage.setItem(KEY, JSON.stringify(state)); }
  function loadPipeline(){
    try {
      const raw = JSON.parse(localStorage.getItem(PIPELINE_KEY)||'{}');
      return mergePipeline(EMPTY_PIPELINE, raw);
    }
    catch(e){ return clone(EMPTY_PIPELINE);}
  }
  function savePipeline(p){ p.updated_at = new Date().toISOString(); localStorage.setItem(PIPELINE_KEY, JSON.stringify(p)); return p; }
  function getBootstrapValue(path){
    const boot = window.GRR_BOOTSTRAP || {};
    return path.split('.').reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key)) ? acc[key] : undefined, boot);
  }
  async function fetchJson(path, fallback){
    const bootPath = path.replace(/^data\//,'').replace(/\.json$/,'').replace(/\//g,'.');
    const bootVal = getBootstrapValue(bootPath);
    if (location.protocol === 'file:') return clone(typeof bootVal === 'undefined' ? fallback : bootVal);
    try {
      const res = await fetch(path);
      if(!res.ok) throw new Error('bad');
      return await res.json();
    }
    catch(e){ return clone(typeof bootVal === 'undefined' ? fallback : bootVal); }
  }
  async function loadData(){
    const embedded = window.GRR_BOOTSTRAP || {};
    const bootstrap = {
      raw: {
        source_a: await fetchJson('data/raw/source_a.json', embedded.raw?.source_a || []),
        source_b: await fetchJson('data/raw/source_b.json', embedded.raw?.source_b || []),
        manual_uploads: await fetchJson('data/raw/manual_uploads.json', embedded.raw?.manual_uploads || [])
      },
      internal: {
        canonical_listings: await fetchJson('data/internal/canonical_listings.json', embedded.internal?.canonical_listings || []),
        source_conflicts: await fetchJson('data/internal/source_conflicts.json', embedded.internal?.source_conflicts || []),
        release_queue: await fetchJson('data/internal/release_queue.json', embedded.internal?.release_queue || []),
        source_runs: await fetchJson('data/internal/source_runs.json', embedded.internal?.source_runs || { runs: [] }),
        leads: await fetchJson('data/internal/leads.json', embedded.internal?.leads || [])
      },
      public: {
        released_listings: await fetchJson('data/public/released_listings.json', embedded.public?.released_listings || []),
        directory_index: await fetchJson('data/public/directory_index.json', embedded.public?.directory_index || { generated_at:null, grace_bypass_until_listing_count:1000, provinces:[] }),
        release_manifest: await fetchJson('data/public/release_manifest.json', embedded.public?.release_manifest || {})
      },
      markets: await fetchJson('data/markets.json', embedded.markets || {})
    };
    const pipeline = loadPipeline();
    const merged = {
      raw: {
        sourceA: (pipeline.raw?.source_a?.length ? pipeline.raw.source_a : bootstrap.raw.source_a),
        sourceB: (pipeline.raw?.source_b?.length ? pipeline.raw.source_b : bootstrap.raw.source_b),
        manualUploads: (pipeline.raw?.manual_uploads?.length ? pipeline.raw.manual_uploads : bootstrap.raw.manual_uploads)
      },
      internal: {
        canonicalListings: (pipeline.internal?.canonical_listings?.length ? pipeline.internal.canonical_listings : bootstrap.internal.canonical_listings),
        sourceConflicts: (pipeline.internal?.source_conflicts?.length ? pipeline.internal.source_conflicts : bootstrap.internal.source_conflicts),
        releaseQueue: (pipeline.internal?.release_queue?.length ? pipeline.internal.release_queue : bootstrap.internal.release_queue),
        sourceRuns: (pipeline.internal?.source_runs?.runs?.length ? pipeline.internal.source_runs : bootstrap.internal.source_runs),
        leads: (pipeline.internal?.leads?.length ? pipeline.internal.leads : bootstrap.internal.leads)
      },
      public: {
        releasedListings: (pipeline.public?.released_listings?.length ? pipeline.public.released_listings : bootstrap.public.released_listings),
        directoryIndex: (pipeline.public?.directory_index?.provinces?.length ? pipeline.public.directory_index : bootstrap.public.directory_index),
        releaseManifest: (pipeline.public?.release_manifest && typeof pipeline.public.release_manifest === 'object' && Object.keys(pipeline.public.release_manifest).length ? pipeline.public.release_manifest : bootstrap.public.release_manifest)
      },
      markets: bootstrap.markets,
      pipelineUpdatedAt: pipeline.updated_at || null
    };
    return merged;
  }
  function currentBypassThreshold(index){ const st = loadState(); return st.graceBypassUntil || index?.grace_bypass_until_listing_count || DEFAULTS.graceBypassUntil; }
  function unresolvedHighRiskConflictCount(listing){
    const highRisk = new Set(['list_price','status','address','city','province']);
    return (listing?.source_conflicts || []).filter(c => (c?.status || 'review') !== 'resolved' && highRisk.has(String(c?.field || '').toLowerCase())).length;
  }
  function getReleaseDecision(listing, canonicalCount=0, index=null){
    if (!listing) return { eligible:false, blocked:true, code:'missing_listing', reason:'Blocked: listing missing.' };
    if (listing.status === 'public_live') return { eligible:true, blocked:false, code:'already_public', reason:'Already public.' };
    if (listing.verification_status !== 'verified_internal') return { eligible:false, blocked:true, code:'verification_required', reason:'Blocked: verification required.' };
    const criticalStale = !!listing?.data_quality?.critical_stale;
    if (criticalStale) return { eligible:false, blocked:true, code:'critical_stale', reason:'Blocked: critical fields stale (price/status).' };
    const highRiskConflicts = unresolvedHighRiskConflictCount(listing);
    if (highRiskConflicts > 0) return { eligible:false, blocked:true, code:'high_risk_conflict', reason:`Blocked: unresolved high-risk conflicts (${highRiskConflicts}).` };
    if (canonicalCount < currentBypassThreshold(index)) return { eligible:true, blocked:false, code:'grace_bypass', reason:'Eligible: bypass under listing threshold.' };
    const ageMs = new Date() - new Date(listing.first_seen_at);
    if (ageMs >= 24*60*60*1000) return { eligible:true, blocked:false, code:'aged_24h', reason:'Eligible: grace window complete.' };
    return { eligible:false, blocked:true, code:'grace_hold', reason:`Hold: ${hoursRemaining(listing.first_seen_at, canonicalCount, index)}.` };
  }
  function hoursRemaining(iso, canonicalCount=0, index=null){ if (canonicalCount < currentBypassThreshold(index)) return 'bypassed under 1k'; const end = new Date(new Date(iso).getTime() + 24*60*60*1000); const ms = end - new Date(); if (ms <= 0) return 'eligible now'; const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000); return `${h}h ${m}m left`; }
  function isPublicEligible(listing, canonicalCount=0, index=null){ return getReleaseDecision(listing, canonicalCount, index).eligible; }
  function getPublicListings(data){ const st = loadState(); const released = clone(data.public.releasedListings || []); const canonical = data.internal.canonicalListings || []; const count = canonical.length; canonical.forEach(l => { const decision = getReleaseDecision(l, count, data.public.directoryIndex); if (decision.eligible && !released.some(r => r.id === l.id)) { const copy = clone(l); copy.public_eligible = true; copy.release_reason = decision.code; copy.release_reason_detail = decision.reason; copy.status = 'public_live'; copy.instant_update_mode = true; if (st.releasedIds.includes(l.id)) copy.manual_release_requested = true; released.push(copy); } }); return released.sort((a,b)=>b.deal_score-a.deal_score); }
  function getInternalOnlyListings(data){ const released = getPublicListings(data); return (data.internal.canonicalListings || []).filter(l => !released.some(r => r.id === l.id)); }
  function addInquiry(payload){ const st = loadState(); st.inquiries.unshift(Object.assign({id:'INQ-'+Date.now(), created_at:new Date().toISOString()}, payload)); saveState(st); return st; }
  function exportInquiries(){ const st = loadState(); st.exportedAt = new Date().toISOString(); saveState(st); return JSON.stringify(st.inquiries, null, 2); }
  function clearInquiries(){ const st = loadState(); st.inquiries = []; saveState(st); }
  function releaseListing(id){ const st = loadState(); if(!st.releasedIds.includes(id)) st.releasedIds.push(id); saveState(st); }
  function addSourceTestNote(note){ const st = loadState(); st.sourceTestNotes.unshift({id:'SRC-'+Date.now(), created_at:new Date().toISOString(), note}); saveState(st); }
  function scoreClass(score){ return score >= 46 ? 'hot' : score >= 35 ? 'warm' : 'cold'; }
  function badgeTags(listing){ const tags = []; if (listing.flags?.price_drop) tags.push(['Price Drop','red']); if (listing.flags?.below_market) tags.push(['Below Market','green']); if (listing.flags?.new_listing) tags.push(['< 24h','blue']); if (listing.flags?.investor) tags.push(['Investor','gold']); if (listing.flags?.fixer) tags.push(['Fixer','gold']); if ((listing.days_on_market || 0) > 60) tags.push(['60+ Days','gray']); return tags; }
  function findConflictForListing(data, listingId){ return (data.internal.sourceConflicts || []).find(c => c.listing_id === listingId) || null; }
  function importRawSource(sourceName, records){ const pipeline = loadPipeline(); if (!pipeline.raw[sourceName]) throw new Error('Unknown source bucket'); pipeline.raw[sourceName] = Array.isArray(records) ? records : []; return savePipeline(pipeline); }
  function mergeRawSource(sourceName, records){ const pipeline = loadPipeline(); if (!pipeline.raw[sourceName]) throw new Error('Unknown source bucket'); pipeline.raw[sourceName] = [...pipeline.raw[sourceName], ...(Array.isArray(records) ? records : [])]; return savePipeline(pipeline); }
  function clearPipeline(){ localStorage.removeItem(PIPELINE_KEY); }
  function runPipeline(){ const pipeline = loadPipeline(); const resolved = window.GRRResolver.reconcile(pipeline.raw); pipeline.internal = resolved.internal; const compiled = window.GRRCompiler.compilePublic(pipeline.internal.canonical_listings, pipeline.public.released_listings, loadState().graceBypassUntil || 1000); pipeline.public = compiled; return savePipeline(pipeline); }
  function pipelineSummary(){ const p = loadPipeline(); return { rawCount:(p.raw.source_a?.length||0)+(p.raw.source_b?.length||0)+(p.raw.manual_uploads?.length||0), canonical:(p.internal.canonical_listings?.length||0), released:(p.public.released_listings?.length||0), conflicts:(p.internal.source_conflicts?.length||0), updated_at:p.updated_at }; }
  return { loadData, loadState, saveState, addInquiry, exportInquiries, clearInquiries, getPublicListings, getInternalOnlyListings, releaseListing, hoursRemaining, isPublicEligible, getReleaseDecision, scoreClass, badgeTags, currentBypassThreshold, addSourceTestNote, findConflictForListing, loadPipeline, savePipeline, importRawSource, mergeRawSource, clearPipeline, runPipeline, pipelineSummary };
})();

function escapeHtml(v){ return String(v ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(v){ return escapeHtml(v); }
function stripTags(v){ return String(v ?? '').replace(/<[^>]*>/g, ''); }


/* ════════════════════════════════════════════════════════════
   SHARED UTILITIES
   Available globally for all pages.
════════════════════════════════════════════════════════════ */
function fmt(n) { return n?Math.round(n).toLocaleString():'–'; }
function fmtPrice(n) {
  if (!n) return 'TBD';
  if (n>=1000000) return '$'+(n/1000000).toFixed(2).replace(/\.?0+$/,'')+'M';
  if (n>=1000) return '$'+Math.round(n/1000)+'K';
  return '$'+n.toLocaleString();
}
function today() { return new Date().toISOString().slice(0,10); }
function now() { return new Date().toISOString(); }
function timeAgo(ts) {
  if (!ts) return '';
  const d = (Date.now()-new Date(ts))/1000;
  if (d<3600) return Math.floor(d/60)+'m ago';
  if (d<86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2400);
}

/* ════════════════════════════════════════════════════════════
   SHARED MARKET BENCHMARKS
   Canonical implementation used across command, public, and
   listings views.  Each consumer may wrap with its own
   price-per-sqft helper; the core bucket/median logic lives
   here to avoid duplication.
════════════════════════════════════════════════════════════ */
function grrMedian(values){
  const arr = (values||[]).map(v=>Number(v)).filter(v=>Number.isFinite(v) && v>0).sort((a,b)=>a-b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}
function grrBucketPush(map, key, value){
  if (!key || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(Number(value));
}
function grrFinalizeBuckets(map){
  const out = new Map();
  map.forEach((values, key) => {
    const med = grrMedian(values);
    if (!med) return;
    out.set(key, { median: med, count: values.length });
  });
  return out;
}
function grrBuildMarketBenchmarks(items, ppsfFn, citySlugFn){
  ppsfFn = ppsfFn || function(l){ const p=Number(l?.list_price||0),s=Number(l?.sqft||0); return (p>0&&s>0)?p/s:null; };
  citySlugFn = citySlugFn || function(l){ return String(l?.city||'').trim().toLowerCase(); };
  const cityType=new Map(), city=new Map(), province=new Map(), national=[];
  (items||[]).forEach(l=>{
    const ppsf=ppsfFn(l); if(!(ppsf>0)) return;
    const prov=String(l?.province||'').trim().toUpperCase();
    const cs=citySlugFn(l);
    const type=String(l?.property_type||'').trim().toLowerCase()||'unknown';
    grrBucketPush(cityType,`${prov}|${cs}|${type}`,ppsf);
    grrBucketPush(city,`${prov}|${cs}`,ppsf);
    grrBucketPush(province,prov,ppsf);
    national.push(ppsf);
  });
  return { cityType:grrFinalizeBuckets(cityType), city:grrFinalizeBuckets(city), province:grrFinalizeBuckets(province), nationalMedian:grrMedian(national), nationalCount:national.length };
}
function grrMarketPosition(listing, benchmarks, ppsfFn, citySlugFn){
  if(!benchmarks) return null;
  ppsfFn = ppsfFn || function(l){ const p=Number(l?.list_price||0),s=Number(l?.sqft||0); return (p>0&&s>0)?p/s:null; };
  citySlugFn = citySlugFn || function(l){ return String(l?.city||'').trim().toLowerCase(); };
  const ppsf=ppsfFn(listing); if(!(ppsf>0)) return null;
  const prov=String(listing?.province||'').trim().toUpperCase();
  const cs=citySlugFn(listing);
  const type=String(listing?.property_type||'').trim().toLowerCase()||'unknown';
  const ctS=benchmarks.cityType?.get?.(`${prov}|${cs}|${type}`);
  const cS=benchmarks.city?.get?.(`${prov}|${cs}`);
  const pS=benchmarks.province?.get?.(prov);
  const src=(ctS?.count>=8?ctS:null)||(cS?.count>=6?cS:null)||(pS?.count>=10?pS:null)||ctS||cS||pS||(benchmarks.nationalMedian?{median:benchmarks.nationalMedian,count:benchmarks.nationalCount||0}:null);
  if(!src||!(src.median>0)) return null;
  const deltaPctRaw=((ppsf-src.median)/src.median)*100;
  const absPct=Math.max(0,Math.round(Math.abs(deltaPctRaw)));
  const direction=deltaPctRaw<0?'below':(deltaPctRaw>0?'above':'at');
  const sqft=Number(listing?.sqft||0);
  return { deltaPctRaw, absPct, direction, baselinePpsf:Math.round(src.median), expectedValue:sqft>0?Math.round(src.median*sqft):null, label:direction==='at'?'At market':`${absPct}% ${direction} market` };
}

/* ════════════════════════════════════════════════════════════
   CANONICAL TYPE CATEGORY
   Maps raw property_type values to filter categories.
════════════════════════════════════════════════════════════ */
function canonicalTypeCategory(v){
  const t = String(v||'').trim().toLowerCase();
  if (!t) return '';
  if (['li','lo','industrial','commercial','com lease'].includes(t)) return 'commercial';
  if (t === 'strata' || t === 'condo' || t === 'apartment') return 'strata';
  if (['land','vacant','lot','acreage','lot-land'].includes(t)) return 'land';
  return 'residential';
}

/* ════════════════════════════════════════════════════════════
   LICENSED MARKET SETTINGS
   Configurable via Settings page, stored in localStorage.
════════════════════════════════════════════════════════════ */
const RAG_LICENSED_KEY = 'rag_licensed_markets';
function loadLicensedMarkets(){
  try {
    const raw = JSON.parse(localStorage.getItem(RAG_LICENSED_KEY));
    if (raw && Array.isArray(raw.cities)) return raw;
  } catch(e){}
  return { province: 'BC', cities: ['vancouver','victoria'] };
}
function saveLicensedMarkets(settings){
  localStorage.setItem(RAG_LICENSED_KEY, JSON.stringify(settings));
}
function isLicensedCity(city, province){
  const m = loadLicensedMarkets();
  const p = String(province||'').toUpperCase();
  const c = String(city||'').trim().toLowerCase();
  if (p === m.province.toUpperCase() && m.cities.includes(c)) return 3; // primary
  if (p === m.province.toUpperCase()) return 2; // provincial
  return 1; // national
}

window.GRRTheme = (function(){
  const KEYS = { public:'gr_theme_public', command:'gr_theme_command' };
  const DEFAULTS = { public:'light', command:'dark' };
  function getMode(scope){ return localStorage.getItem(KEYS[scope]) || DEFAULTS[scope] || 'light'; }
  function setMode(scope, mode){ localStorage.setItem(KEYS[scope], mode); }
  function apply(scope){
    const body = document.body; if(!body) return getMode(scope);
    body.classList.remove('theme-light','theme-dark');
    const mode = getMode(scope);
    body.classList.add('theme-' + mode);
    document.querySelectorAll('[data-theme-label]').forEach(el => {
      el.textContent = mode === 'dark' ? 'Light Theme' : 'Dark Theme';
    });
    return mode;
  }
  function init(scope){
    const run = () => apply(scope);
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
    else run();
  }
  function toggle(scope){
    const next = getMode(scope) === 'dark' ? 'light' : 'dark';
    setMode(scope, next);
    return apply(scope);
  }
  return { getMode, setMode, apply, init, toggle };
})();
