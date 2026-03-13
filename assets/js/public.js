
async function getReleasedListings(){
  const data = await GRR.loadData();
  return { data, items: GRR.getPublicListings(data) };
}
function toNum(v){ return Number(v || 0) || 0; }
function normalizeType(v=''){ return String(v || '').trim().toLowerCase(); }
function normalizeSearchText(v=''){
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const PROVINCE_NAME_BY_CODE = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon'
};
function provinceSearchText(v=''){
  const code = String(v || '').trim().toUpperCase();
  if (PROVINCE_NAME_BY_CODE[code]) return `${code} ${PROVINCE_NAME_BY_CODE[code]}`;
  return String(v || '');
}
function listingCoverageStats(items=[]){
  const provinceSet = new Set();
  const citySet = new Set();
  items.forEach(listing => {
    const province = String(listing?.province || '').trim().toUpperCase();
    const city = String(listing?.city || '').trim().toLowerCase();
    if (province) provinceSet.add(province);
    if (city) citySet.add(`${province}:${city}`);
  });
  return {
    total: items.length,
    provinces: provinceSet.size,
    cities: citySet.size
  };
}
function updatePublicCoverageSummary(data, items=[]){
  const target = document.getElementById('public-coverage-summary');
  if (!target) return;
  const stats = listingCoverageStats(items);
  const manifest = data?.public?.releaseManifest || {};
  const coverage = manifest?.coverage?.released_public || {};
  const nationalTarget = Number(manifest?.coverage?.national_province_target) || Object.keys(PROVINCE_NAME_BY_CODE).length;
  const provinceCount = Number.isFinite(Number(coverage?.province_count)) ? Number(coverage.province_count) : stats.provinces;
  const cityCount = Number.isFinite(Number(coverage?.city_count)) ? Number(coverage.city_count) : stats.cities;
  const status = provinceCount >= nationalTarget
    ? 'National coverage is currently live.'
    : `Currently live in ${provinceCount} of ${nationalTarget} provinces/territories.`;
  target.textContent = `Current real-source coverage: ${stats.total.toLocaleString()} released listings across ${provinceCount} provinces/territories and ${cityCount} cities. ${status}`;
}
function updatePublicProvinceBreakdown(items=[]){
  const target = document.getElementById('public-province-breakdown');
  if (!target) return;
  const counts = new Map();
  items.forEach(listing => {
    const code = String(listing?.province || '').trim().toUpperCase();
    if (!code) return;
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a,b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  if (!rows.length){
    target.innerHTML = '<span class="pill">No released listings</span>';
    return;
  }
  target.innerHTML = rows.map(([code,count]) => {
    const name = PROVINCE_NAME_BY_CODE[code] || code;
    return `<span class="pill" title="${escapeHtml(name)}">${escapeHtml(code)} · ${count.toLocaleString()}</span>`;
  }).join(' ');
}
function toIsoDate(v=''){
  if (!v) return '';
  const d = String(v).length === 10 ? new Date(`${v}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0,10);
}
function listingPostedDate(listing){
  return toIsoDate(listing?.date_listed || listing?.first_seen_at || listing?.created_at || listing?.fetched_at || listing?.public_released_at || listing?.price_history?.[0]?.date || '');
}
function listingPostedLabel(listing){
  const iso = listingPostedDate(listing);
  return iso ? `Posted ${iso}` : 'Posted date n/a';
}
function publicPropertyTypeLabel(v=''){
  const raw = String(v || '').trim();
  if (!raw) return '';
  return raw.split(/[-_ ]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
function publicListingPricePerSqft(listing){
  const price = toNum(listing?.list_price);
  const sqft = toNum(listing?.sqft);
  if (!(price > 0 && sqft > 0)) return null;
  return Math.round(price / sqft);
}
/* Market benchmark functions delegated to shared grrBuildMarketBenchmarks / grrMarketPosition in utils.js */
function buildPublicMarketBenchmarks(items){
  return grrBuildMarketBenchmarks(items, publicListingPricePerSqft, function(l){ return normalizeSearchText(l?.city||''); });
}
function publicListingMarketPosition(listing, benchmarks){
  return grrMarketPosition(listing, benchmarks, publicListingPricePerSqft, function(l){ return normalizeSearchText(l?.city||''); });
}
function publicListingDom(listing){
  const posted = listingPostedDate(listing);
  if (!posted) return null;
  const d = new Date(`${posted}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function publicListingFactLine(listing, benchmarks=null){
  const bits = [];
  if (listing?.status) bits.push(`Status ${String(listing.status).replaceAll('_',' ')}`);
  if (toNum(listing?.beds)) bits.push(`${toNum(listing.beds)} bed`);
  if (toNum(listing?.baths)) bits.push(`${toNum(listing.baths)} bath`);
  if (toNum(listing?.sqft)) bits.push(`${toNum(listing.sqft).toLocaleString()} sqft`);
  const type = publicPropertyTypeLabel(listing?.property_type);
  if (type) bits.push(type);
  if (listing?.year_built) bits.push(`Built ${listing.year_built}`);
  const ppsf = publicListingPricePerSqft(listing);
  if (ppsf) bits.push(`$${ppsf}/sqft`);
  const dom = publicListingDom(listing);
  if (dom !== null) bits.push(`DOM ${dom}`);
  const market = publicListingMarketPosition(listing, benchmarks);
  if (market?.label) bits.push(market.label);
  return bits.join(' · ');
}
function toCommercialType(v=''){
  const t = normalizeType(v);
  if (['li','lo','industrial','commercial'].includes(t)) return 'commercial';
  return t;
}
const LICENSED_PUBLIC_PROVINCE = 'BC';
const LICENSED_PUBLIC_CITIES = ['vancouver','victoria'];
function listingLicensedPriority(listing){
  const province = String(listing?.province || '').toUpperCase();
  const city = normalizeType(listing?.city || '');
  if (province === LICENSED_PUBLIC_PROVINCE && LICENSED_PUBLIC_CITIES.includes(city)) return 3;
  if (province === LICENSED_PUBLIC_PROVINCE) return 2;
  return 1;
}
function parsePublicFilterState(){
  const params = new URLSearchParams(location.search);
  return {
    q: (params.get('q') || '').trim(),
    beds: toNum(params.get('beds')),
    type: normalizeType(params.get('type')),
    maxPrice: toNum(params.get('max')),
    sort: normalizeType(params.get('sort')) || 'deal_desc'
  };
}
function currentPublicFilterState(){
  const defaults = parsePublicFilterState();
  const qEl = document.getElementById('public-search-input');
  const bedsEl = document.getElementById('public-filter-beds');
  const typeEl = document.getElementById('public-filter-type');
  const priceEl = document.getElementById('public-filter-price');
  const activeSort = document.querySelector('[data-public-sort].active');
  return {
    q: (qEl?.value ?? defaults.q).trim(),
    beds: toNum(bedsEl?.value ?? defaults.beds),
    type: normalizeType(typeEl?.value ?? defaults.type),
    maxPrice: toNum(priceEl?.value ?? defaults.maxPrice),
    sort: normalizeType(activeSort?.dataset?.publicSort || defaults.sort || 'deal_desc')
  };
}
function syncPublicControlsFromState(state){
  const qEl = document.getElementById('public-search-input');
  const bedsEl = document.getElementById('public-filter-beds');
  const typeEl = document.getElementById('public-filter-type');
  const priceEl = document.getElementById('public-filter-price');
  if (qEl) qEl.value = state.q || '';
  if (bedsEl) bedsEl.value = state.beds ? String(state.beds) : '';
  if (typeEl) typeEl.value = state.type || '';
  if (priceEl) priceEl.value = state.maxPrice ? String(state.maxPrice) : '';
  document.querySelectorAll('[data-public-sort]').forEach(btn => {
    btn.classList.toggle('active', normalizeType(btn.dataset.publicSort) === (state.sort || 'deal_desc'));
  });
}
function syncPublicUrl(state){
  if (!window.history?.replaceState) return;
  const params = new URLSearchParams(location.search);
  const next = {
    q: (state.q || '').trim(),
    beds: toNum(state.beds),
    type: normalizeType(state.type),
    max: toNum(state.maxPrice),
    sort: normalizeType(state.sort) || 'deal_desc'
  };
  if (next.q) params.set('q', next.q); else params.delete('q');
  if (next.beds) params.set('beds', String(next.beds)); else params.delete('beds');
  if (next.type) params.set('type', next.type); else params.delete('type');
  if (next.max) params.set('max', String(next.max)); else params.delete('max');
  if (next.sort && next.sort !== 'deal_desc') params.set('sort', next.sort); else params.delete('sort');
  const query = params.toString();
  const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash || ''}`;
  history.replaceState(null, '', url);
}
function matchesPublicFilters(listing, state){
  const q = normalizeSearchText(state.q || '');
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const blob = normalizeSearchText(`${listing.address || ''} ${listing.city || ''} ${provinceSearchText(listing.province)} ${listing.postal_code || ''} ${listing.public_summary || ''} ${listing.market_slug || ''} ${listing.property_type || ''}`);
    if (!tokens.every(token => blob.includes(token))) return false;
  }
  if (state.beds && toNum(listing.beds) < state.beds) return false;
  if (state.maxPrice && toNum(listing.list_price) > state.maxPrice) return false;
  if (state.type) {
    const listingType = toCommercialType(listing.property_type);
    const targetType = toCommercialType(state.type);
    if (listingType !== targetType) return false;
  }
  return true;
}
function sortPublicListings(items, sort){
  const mode = normalizeType(sort) || 'deal_desc';
  const rows = [...items];
  rows.sort((a,b)=>{
    const priorityDelta = listingLicensedPriority(b) - listingLicensedPriority(a);
    if (mode === 'price_asc') return (toNum(a.list_price) - toNum(b.list_price)) || priorityDelta;
    if (mode === 'price_desc') return (toNum(b.list_price) - toNum(a.list_price)) || priorityDelta;
    if (mode === 'newest') return (new Date(listingPostedDate(b) || 0) - new Date(listingPostedDate(a) || 0)) || priorityDelta;
    if (mode === 'days_desc') return (toNum(b.days_on_market) - toNum(a.days_on_market)) || priorityDelta;
    return (toNum(b.deal_score) - toNum(a.deal_score)) || priorityDelta;
  });
  return rows;
}
function updatePublicResultSummary(total, shown){
  const target = document.getElementById('public-result-summary');
  if (!target) return;
  target.textContent = `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} released listings`;
}
function bindPublicControls(){
  const controls = [
    document.getElementById('public-search-input'),
    document.getElementById('public-filter-beds'),
    document.getElementById('public-filter-type'),
    document.getElementById('public-filter-price'),
    document.getElementById('public-search-button')
  ].filter(Boolean);
  if (!controls.length) return;
  const searchBtn = document.getElementById('public-search-button');
  if (searchBtn && !searchBtn.dataset.bound){
    searchBtn.dataset.bound = '1';
    searchBtn.addEventListener('click', () => {
      if (document.getElementById('listingGrid')) renderPublicListings('listingGrid');
      if (document.getElementById('directoryListingGrid')) renderDirectoryListings();
    });
  }
  const searchInput = document.getElementById('public-search-input');
  if (searchInput && !searchInput.dataset.bound){
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        if (document.getElementById('listingGrid')) renderPublicListings('listingGrid');
        if (document.getElementById('directoryListingGrid')) renderDirectoryListings();
      }
    });
  }
  ['public-filter-beds','public-filter-type','public-filter-price'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('change', ()=>{
      if (document.getElementById('listingGrid')) renderPublicListings('listingGrid');
      if (document.getElementById('directoryListingGrid')) renderDirectoryListings();
    });
  });
  document.querySelectorAll('[data-public-sort]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('[data-public-sort]').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      if (document.getElementById('listingGrid')) renderPublicListings('listingGrid');
      if (document.getElementById('directoryListingGrid')) renderDirectoryListings();
    });
  });
}
function initPublicFilterControls(){
  const state = parsePublicFilterState();
  syncPublicControlsFromState(state);
  bindPublicControls();
}

async function renderPublicListings(targetId, onlyId){
  const { data, items } = await getReleasedListings();
  const benchmarks = buildPublicMarketBenchmarks(items);
  initPublicFilterControls();
  const state = currentPublicFilterState();
  syncPublicUrl(state);
  let filtered = onlyId ? items.filter(x => x.id === onlyId) : items;
  if (!onlyId) filtered = sortPublicListings(filtered.filter(l => matchesPublicFilters(l, state)), state.sort);
  const wrap = document.getElementById(targetId); if(!wrap) return;
  updatePublicResultSummary(items.length, filtered.length);
  updatePublicCoverageSummary(data, items);
  updatePublicProvinceBreakdown(items);
  if (!filtered.length){ wrap.innerHTML = '<div class="banner">No released listings match the current search/filter settings.</div>'; return; }
  wrap.innerHTML = filtered.map(l => `
    <article class="listing-card">
      <div class="thumb">${window.GPSFallbackMap ? GPSFallbackMap.listingThumbnailHtml(l, {provider:'topo'}) : '🏠'}</div>
      <div class="body">
        <div class="badges">${GRR.badgeTags(l).map(t=>`<span class="tag ${escapeAttr(t[1])}">${escapeHtml(t[0])}</span>`).join('')}<span class="tag gray">Verified</span></div>
        <div class=\"row\"><div><div class=\"price\">$${escapeHtml(l.price_label || Number(l.list_price||0).toLocaleString())}</div><div class=\"addr\">${escapeHtml(l.address||'')}</div><div class=\"meta\">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')} · ${escapeHtml(listingPostedLabel(l))}${publicListingFactLine(l, benchmarks) ? ` · ${escapeHtml(publicListingFactLine(l, benchmarks))}` : ''}</div></div><div><span class=\"pill\" style=\"color:#8f6a14;border-color:#e8c56f;background:#fff7e2\">Deal ${Number(l.deal_score||0)}%</span>${(() => { const m = publicListingMarketPosition(l, benchmarks); return m?.label ? `<span class=\"pill\" style=\"margin-left:8px;color:${m.direction==='below'?'#1f7a46':(m.direction==='above'?'#8a4a12':'#41536a')};border-color:${m.direction==='below'?'#95dbb2':(m.direction==='above'?'#f1c28f':'#c9d3de')};background:${m.direction==='below'?'#ebfff3':(m.direction==='above'?'#fff4ea':'#f4f8fc')}\">${escapeHtml(m.label)}</span>` : ''; })()}</div></div>
        <div class="dealbox">${escapeHtml(l.public_summary||'')}</div>
        ${l.source_inconsistency?.public_note ? `<div class="banner" style="margin-top:14px">Source note: ${escapeHtml(l.source_inconsistency.public_note)}</div>`:''}
        <div class="foot"><a class="btn ghost" href="listing-detail.html?id=${encodeURIComponent(l.id)}">View Listing</a><button class="btn gold" onclick="openInquiry('${escapeAttr(l.id)}')">Ask R&G</button></div>
      </div>
    </article>`).join('');
}

function openInquiry(listingId='general'){ const modal = document.getElementById('inquiryModal'); if(!modal) return; modal.dataset.listingId = listingId; modal.style.display = 'flex'; }
function closeInquiry(){ const modal = document.getElementById('inquiryModal'); if(modal) modal.style.display = 'none'; }

function setupInquiryForm(){
  const form = document.getElementById('inquiryForm'); if(!form) return;
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const modal = document.getElementById('inquiryModal');
    const data = Object.fromEntries(new FormData(form).entries());
    GRR.addInquiry({
      listing_id: modal.dataset.listingId || 'general',
      source: 'public_website', intent: data.intent, name: data.name, email: data.email, phone: data.phone,
      market: data.market, budget: data.budget, timeline: data.timeline, notes: data.notes, branch_hint: data.branch_hint || 'general_queue'
    });
    form.reset(); closeInquiry();
    alert('Inquiry routed to R&G Command Center. It is now in the internal review queue.');
  });
}

async function renderMarkets(){
  const data = await GRR.loadData();
  const index = data.public.directoryIndex || { provinces:[] };
  const wrap = document.getElementById('marketGrid'); if(!wrap) return;
  wrap.innerHTML = (index.provinces||[]).length ? index.provinces.map(p => {
    const bestCity = (p.cities || [])[0];
    return `<a class="market-card" href="directory.html#${p.slug}">
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.summary||'')}</p>
      <div class="num">${p.listing_count || 0}</div>
      <p>released listings now live</p>
      ${bestCity ? `<div class="tiny" style="margin-top:10px">Top live city · ${escapeHtml(bestCity.name)} · ${bestCity.top_deal_score}%</div>` : `<div class="tiny" style="margin-top:10px">No released listings in current pack</div>`}
    </a>`;
  }).join('') : '<div class="banner">No released province index exists yet. Connect a source or import local data, then reconcile and compile.</div>';
}

async function renderDirectoryListings(){
  const data = await GRR.loadData();
  const released = GRR.getPublicListings(data);
  const benchmarks = buildPublicMarketBenchmarks(released);
  initPublicFilterControls();
  const state = currentPublicFilterState();
  syncPublicUrl(state);
  updatePublicCoverageSummary(data, released);
  updatePublicProvinceBreakdown(released);
  const index = data.public.directoryIndex || { provinces:[] };
  const wrap = document.getElementById('directoryListingGrid');
  const summary = document.getElementById('directorySummary');
  if(summary){
    summary.innerHTML = (index.provinces||[]).filter(p=>p.listing_count).length
      ? index.provinces.filter(p=>p.listing_count).map(p=>`<span class="pill">${escapeHtml(p.name)} · ${p.listing_count} live</span>`).join(' ')
      : '<span class="pill">No public listings yet</span>';
  }
  if(!wrap) return;
  const hash = (location.hash || '').replace('#','').toLowerCase();
  let items = released;
  if(hash){
    const province = (index.provinces||[]).find(p => p.slug === hash || String(p.province_code||'').toLowerCase() === hash);
    const target = province ? province.province_code : hash.toUpperCase();
    items = released.filter(l => String(l.province||'').toUpperCase() === target || String(l.market_slug||'').includes(hash));
  }
  items = sortPublicListings(items.filter(l => matchesPublicFilters(l, state)), state.sort);
  updatePublicResultSummary(released.length, items.length);
  if(!items.length){
    wrap.innerHTML = '<div class="banner">No released listings match this directory view and filter set yet.</div>';
    return;
  }
  wrap.innerHTML = items.map(l=>`
    <article class="listing-card">
      <div class="thumb">${window.GPSFallbackMap ? GPSFallbackMap.listingThumbnailHtml(l, {provider:'topo'}) : '🏠'}</div>
      <div class="body">
        <div class="badges">${GRR.badgeTags(l).map(t=>`<span class="tag ${escapeAttr(t[1])}">${escapeHtml(t[0])}</span>`).join('')}<span class="tag gray">${escapeHtml(l.province||'')}</span></div>
        <div class=\"row\"><div><div class=\"price\">$${escapeHtml(l.price_label || Number(l.list_price||0).toLocaleString())}</div><div class=\"addr\">${escapeHtml(l.address||'')}</div><div class=\"meta\">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')} · ${escapeHtml(listingPostedLabel(l))}${publicListingFactLine(l, benchmarks) ? ` · ${escapeHtml(publicListingFactLine(l, benchmarks))}` : ''}</div></div><div><span class=\"pill\" style=\"color:#8f6a14;border-color:#e8c56f;background:#fff7e2\">Deal ${Number(l.deal_score||0)}%</span>${(() => { const m = publicListingMarketPosition(l, benchmarks); return m?.label ? `<span class=\"pill\" style=\"margin-left:8px;color:${m.direction==='below'?'#1f7a46':(m.direction==='above'?'#8a4a12':'#41536a')};border-color:${m.direction==='below'?'#95dbb2':(m.direction==='above'?'#f1c28f':'#c9d3de')};background:${m.direction==='below'?'#ebfff3':(m.direction==='above'?'#fff4ea':'#f4f8fc')}\">${escapeHtml(m.label)}</span>` : ''; })()}</div></div>
        <div class="dealbox">${escapeHtml(l.public_summary||'')}</div>
        <div class="foot"><a class="btn ghost" href="listing-detail.html?id=${encodeURIComponent(l.id)}">View Listing</a><button class="btn gold" onclick="openInquiry('${escapeAttr(l.id)}')">Ask R&G</button></div>
      </div>
    </article>`).join('');
}

document.addEventListener('DOMContentLoaded', ()=>{
  setupInquiryForm();
  initPublicFilterControls();
  renderMarkets();
  renderDirectoryListings();
  if (document.getElementById('listingGrid')) renderPublicListings('listingGrid');
});
