
function setText(id,val){ const el=document.getElementById(id); if(el) el.textContent = val; }
function fmtNum(v){ return Number(v||0).toLocaleString(); }
function scoreBand(score){ return score >= 46 ? 'hot' : score >= 35 ? 'warm' : 'cold'; }
function padRows(msg, cols=6){ return `<tr><td colspan="${cols}">${msg}</td></tr>`; }
/* Market benchmark functions delegated to shared grrBuildMarketBenchmarks / grrMarketPosition in utils.js */
function buildMarketBenchmarks(items){ return grrBuildMarketBenchmarks(items); }
function listingMarketPosition(listing, benchmarks){ return grrMarketPosition(listing, benchmarks); }

async function initCommand(){
  const data = await GRR.loadData();
  const state = GRR.loadState();
  const internalListings = data.internal.canonicalListings || [];
  const publicListings = GRR.getPublicListings(data) || [];
  const internalOnly = GRR.getInternalOnlyListings(data) || [];
  const marketBench = buildMarketBenchmarks(internalListings.length ? internalListings : publicListings);
  const leads = (data.internal.leads || []).concat((state.inquiries||[]).map(i => ({
    name:i.name, email:i.email, phone:i.phone || '—', score_band:'warm', timeline:i.timeline || 'new', notes:i.notes, source:i.source || 'public_website', market:i.market || '', budget:i.budget || '', intent:i.intent || 'inquiry', created_at:i.created_at || ''
  })));
  const unresolved = (data.internal.sourceConflicts || []).filter(c=>c.status!=='resolved').length || (data.internal.sourceConflicts || []).length;
  const topDeal = internalListings.length ? Math.max(...internalListings.map(l => Number(l.deal_score||0))) : 0;

  setText('statHot', leads.filter(l=> (l.score_band||scoreBand(l.deal_score||0)) === 'hot').length);
  setText('statWarm', leads.filter(l=> (l.score_band||scoreBand(l.deal_score||0)) === 'warm').length);
  setText('statActive', internalListings.length);
  setText('statTop', topDeal ? topDeal : '—');
  setText('statDrops', internalListings.filter(l=>l.flags && l.flags.price_drop).length);
  setText('statSources', (data.internal.sourceRuns?.runs || []).reduce((sum,r)=>sum+Number(r.records||0),0));
  setText('statConflicts', unresolved);
  setText('statPublic', publicListings.length);
  setText('statInternalOnly', internalOnly.length);

  renderWhoToCall(leads);
  renderTopDeals(internalListings, marketBench);
  renderSignals(internalListings);
  renderReleaseQueue(data, internalOnly);
  renderConflictTable(data.internal.sourceConflicts || []);
  renderInbox(leads);
  renderSourceRuns(data.internal.sourceRuns?.runs || []);
  renderSourceSnapshots(data.raw || {});
  renderPublicSummary(publicListings, data.public.directoryIndex || { provinces:[], grace_bypass_until_listing_count:1000 });
  renderListingTable('allListingsBody', internalListings, data, false, marketBench);
  renderListingTable('internalOnlyBody', internalOnly, data, false, marketBench);
  renderListingTable('publicLiveBody', publicListings, data, true, marketBench);
  renderLeadTable('leadRows', leads);
  renderConflictCards('conflictCards', data.internal.sourceConflicts || []);
  setupHelp();
  setupTabs();
}

function renderWhoToCall(items){
  const wrap=document.getElementById('cq-list')||document.getElementById('callQueue'); if(!wrap) return;
  if(!items.length){ wrap.innerHTML='<div class="queue-item"><div class="q-body"><div class="q-copy">No leads yet. Add one in the + Add tab or capture one from the public site.</div></div></div>'; return; }
  wrap.innerHTML = items.slice(0,6).map((p)=>`<div class="queue-item"><div class="ring ${escapeAttr(p.score_band||'warm')}">${escapeHtml((p.name||'?')[0])}</div><div class="q-body"><div class="q-name">${escapeHtml(p.name||'Unnamed')}</div><div class="q-meta">${escapeHtml(p.phone || '')}${p.email ? ' · '+escapeHtml(p.email) : ''}${p.timeline ? ' · '+escapeHtml(p.timeline) : ''}</div><div class="q-copy">${escapeHtml(p.notes || p.intent || '')}</div></div><div class="q-actions"><button>${p.phone && p.phone!=='—' ? 'Call' : 'Email'}</button></div></div>`).join('');
}
function renderTopDeals(items, benchmarks=null){
  const wrap=document.getElementById('deals-tbody')||document.getElementById('dealRows'); if(!wrap) return;
  if(!items.length){ wrap.innerHTML = padRows('No listings yet'); return; }
  wrap.innerHTML = [...items].sort((a,b)=>Number(b.deal_score||0)-Number(a.deal_score||0)).slice(0,6).map(l=>{ const m=listingMarketPosition(l, benchmarks); const mTag=m?`<span class="tag ${m.direction==='below'?'below':(m.direction==='above'?'drop':'new')}">${escapeHtml(m.label)}</span>`:''; return `<tr><td><div style="font-weight:700">${escapeHtml(l.address||'')}</div><div class="tiny">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')}</div></td><td>$${escapeHtml(l.price_label || fmtNum(l.list_price))}</td><td>${fmtNum(l.beds)}bd ${fmtNum(l.baths)}ba</td><td><span class="scorebar"><span class="scorefill" style="width:${Number(l.deal_score||0)}%"></span></span>${Number(l.deal_score||0)}%</td><td>${mTag} ${GRR.badgeTags(l).map(t=>`<span class="tag ${t[1]}">${t[0]}</span>`).join(' ')}</td></tr>`; }).join('');
}
function renderSignals(items){
  const wrap=document.getElementById('sig-feed')||document.getElementById('signalFeed'); if(!wrap) return;
  const rows=[]; items.forEach(l=> (l.internal_signals||[]).forEach(s => rows.push({addr:l.address, desc:s})));
  wrap.innerHTML = rows.length ? rows.slice(0,10).map((s,i)=>`<div class="sig-item"><div class="sig-ico">${['↧','◈','◌','✦'][i%4]}</div><div><div class="sig-title">${escapeHtml(s.addr||'')}</div><div class="sig-desc">${escapeHtml(s.desc||'')}</div></div></div>`).join('') : '<div class="sig-item"><div><div class="sig-desc">No signals yet.</div></div></div>';
}
function renderReleaseQueue(data, items){
  const wrap=document.getElementById('releaseQueue'); if(!wrap) return;
  const count = (data.internal.canonicalListings||[]).length;
  wrap.innerHTML = items.length ? items.map(l=>{
    const decision = GRR.getReleaseDecision ? GRR.getReleaseDecision(l, count, data.public.directoryIndex) : { eligible: GRR.isPublicEligible(l, count, data.public.directoryIndex), blocked:false, reason:'' };
    const timing = decision.code === 'grace_hold' ? GRR.hoursRemaining(l.first_seen_at, count, data.public.directoryIndex) : (decision.eligible ? 'eligible' : 'blocked');
    const reason = decision.reason || l.internal_gate_note || 'Waiting on release handling.';
    return `<div class="release-row"><div class="release-top"><div><div style="font-weight:700">${escapeHtml(l.address||'')}</div><div class="tiny">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')} · verification: ${(l.verification_status||'').replaceAll('_',' ')}</div></div><div class="countdown">${escapeHtml(timing)}</div></div><div class="q-copy" style="margin-top:8px;color:${decision.blocked?'#e9546f':'inherit'}">${escapeHtml(reason)}</div><div style="display:flex;gap:8px;margin-top:10px"><button class="tab-btn" ${decision.eligible?'':'disabled'} onclick="releaseNow('${l.id}')">Release to Public</button><button class="tab-btn" onclick="location.href='listings.html'">Review Listing</button></div></div>`;
  }).join('') : '<div class="release-row"><div class="q-copy">No internal-only listings are waiting right now.</div></div>';
}
function releaseNow(id){ GRR.releaseListing(id); location.reload(); }
function renderConflictTable(conflicts){
  const wrap=document.getElementById('conflictsBody'); if(!wrap) return;
  wrap.innerHTML = conflicts.length ? conflicts.map(l=>`<tr><td>${escapeHtml(l.address||'')}</td><td><span class="src">${escapeHtml(l.field||'')}</span></td><td>${escapeHtml(String(l.source_a_value??''))}</td><td>${escapeHtml(String(l.source_b_value??''))}</td><td>${escapeHtml(String(l.canonical_value??''))}</td><td>${escapeHtml(l.resolution||'')}</td></tr>`).join('') : padRows('No active source conflicts.');
}
function renderInbox(items){
  const wrap=document.getElementById('inboxRows'); if(!wrap) return;
  wrap.innerHTML = items.length ? items.map(i=>`<div class="queue-item"><div class="ring ${i.score_band||'warm'}">${(i.name||'?')[0]}</div><div class="q-body"><div class="q-name">${escapeHtml(i.name||'')}</div><div class="q-meta">${escapeHtml(i.email||'')} ${i.phone ? ' · '+escapeHtml(i.phone) : ''} ${i.intent ? ' · '+escapeHtml(i.intent) : ''} ${i.market ? ' · '+escapeHtml(i.market) : ''}</div><div class="q-copy">${escapeHtml(i.notes || 'No notes')}</div></div><div class="q-actions"><button>Assign</button></div></div>`).join('') : '<div class="queue-item"><div class="q-body"><div class="q-copy">No live public inquiries captured yet in this browser session.</div></div></div>';
}
function exportInbox(){ const blob = new Blob([GRR.exportInquiries()], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='gr-command-center-inquiries.json'; a.click(); }
function clearInbox(){ if(confirm('Clear local inquiry queue?')){ GRR.clearInquiries(); location.reload(); } }
function renderSourceRuns(runs){
  const wrap=document.getElementById('sourceRuns'); if(!wrap) return;
  wrap.innerHTML = runs.length ? runs.map(r=>`<div class="sig-item"><div class="sig-ico">${r.status==='ok'?'◉':'○'}</div><div><div class="sig-title">${escapeHtml(r.source||'')}</div><div class="sig-desc">${fmtNum(r.records)} records · ${escapeHtml(r.mode||'')} · ${escapeHtml(r.captured_at||'')}</div></div></div>`).join('') : '<div class="sig-item"><div><div class="sig-desc">No source runs yet. Open Settings to connect APIs or use the import tool.</div></div></div>';
}
function renderSourceSnapshots(raw){
  const wrap=document.getElementById('sourceSnapshots'); if(!wrap) return;
  const rows=[...(raw.sourceA||[]).slice(0,2), ...(raw.sourceB||[]).slice(0,2), ...(raw.manualUploads||[]).slice(0,2)];
  wrap.innerHTML = rows.length ? rows.map(r=>`<tr><td>${escapeHtml(r.source||'manual')}</td><td>${escapeHtml(r.address||'')}</td><td>${escapeHtml(r.city||'')}, ${escapeHtml(r.province||'')}</td><td>${fmtNum(r.beds)} / ${fmtNum(r.baths)}</td><td>${fmtNum(r.sqft)}</td><td>$${fmtNum(r.list_price)}</td></tr>`).join('') : padRows('No raw source snapshots yet.', 6);
}
function renderPublicSummary(publicListings, index){
  const wrap=document.getElementById('publicSummary'); if(!wrap) return;
  const provinceLive = (index.provinces||[]).filter(p=>p.listing_count).length;
  wrap.innerHTML = `<div class="banner">Released now: <b>${publicListings.length}</b> · Provinces with live listings: <b>${provinceLive}</b> · Grace bypass threshold: <b>${index.grace_bypass_until_listing_count||1000}</b></div>`;
}
function renderListingTable(id, items, data, publicOnly=false, benchmarks=null){
  const wrap=document.getElementById(id); if(!wrap) return;
  if(!items.length){ wrap.innerHTML = padRows(publicOnly ? 'No public listings yet.' : 'No internal listings yet.'); return; }
  wrap.innerHTML = items.map(l => {
    const conflict = GRR.findConflictForListing(data, l.id);
    const decision = GRR.getReleaseDecision ? GRR.getReleaseDecision(l, (data.internal.canonicalListings||[]).length, data.public.directoryIndex) : { eligible:GRR.isPublicEligible(l, (data.internal.canonicalListings||[]).length, data.public.directoryIndex), blocked:false, code:'unknown' };
    const state = publicOnly ? 'public_live' : (decision.eligible ? 'eligible' : `blocked_${decision.code || 'internal_only'}`);
    const market = listingMarketPosition(l, benchmarks);
    return `<tr><td><div style="font-weight:700">${escapeHtml(l.address||'')}</div><div class="tiny">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')}${market?.label ? ` · ${escapeHtml(market.label)}` : ''}</div></td><td>$${escapeHtml(l.price_label || fmtNum(l.list_price))}</td><td>${fmtNum(l.beds)} / ${fmtNum(l.baths)}</td><td>${fmtNum(l.sqft)}</td><td>${Number(l.deal_score||0)}%</td><td><span class="src">${state.replaceAll('_',' ')}</span>${conflict ? ' <span class="tag red">conflict</span>' : ''}</td></tr>`;
  }).join('');
}
function renderLeadTable(id, items){
  const wrap=document.getElementById(id); if(!wrap) return;
  if(!items.length){ wrap.innerHTML = padRows('No leads or inquiries yet.', 6); return; }
  wrap.innerHTML = items.map(l => `<tr><td>${escapeHtml(l.name||'')}</td><td>${escapeHtml(l.email||'')}</td><td>${escapeHtml(l.phone||'—')}</td><td>${escapeHtml(l.intent||'lead')}</td><td>${escapeHtml(l.market||'—')}</td><td><span class="tag ${l.score_band==='hot'?'red':(l.score_band==='warm'?'gold':'blue')}">${escapeHtml(l.score_band||'warm')}</span></td></tr>`).join('');
}
function renderConflictCards(id, conflicts){
  const wrap=document.getElementById(id); if(!wrap) return;
  wrap.innerHTML = conflicts.length ? conflicts.slice(0,10).map(c => `<div class="release-row"><div class="release-top"><div><div style="font-weight:700">${escapeHtml(c.address||'')}</div><div class="tiny">${escapeHtml(c.field||'')} mismatch</div></div><span class="tag red">review</span></div><div class="q-copy" style="margin-top:8px">Source A: ${escapeHtml(String(c.source_a_value??''))} · Source B: ${escapeHtml(String(c.source_b_value??''))} · Canonical: ${escapeHtml(String(c.canonical_value??''))}</div></div>`).join('') : '<div class="release-row"><div class="q-copy">No current conflicts.</div></div>';
}

function setupTabs(){
  document.querySelectorAll('[data-tab-btn]').forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab-btn');
    document.querySelectorAll('[data-tab-btn]').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('[data-tab-panel]').forEach(x=>x.style.display='none');
    btn.classList.add('active');
    const panel = document.querySelector(`[data-tab-panel="${tab}"]`); if(panel) panel.style.display='block';
  }));
}

function setupHelp(){
  const steps = [
    {t:'RAG Realty gets everything first.', b:'This internal page is for non-stock real estate intake only. Raw source files, API pulls, verification work, source conflicts, release review, and inquiry handling all land here before anything should appear on the public directory.'},
    {t:'Settings drives intake.', b:'Use Settings to add JSON endpoints, auth headers, field maps, and sync modes. Browser-friendly APIs can populate raw source buckets directly from there.'},
    {t:'Public only reads compiled releases.', b:'The public site never reads raw source files directly. Reconcile and compile from Settings so the browser only sees verified released records.'},
    {t:'Grace period stays ready for scale.', b:'Under the first 1000 verified listings, the grace gate is bypassed for clean testing. After that, new listings can stay internal for 24 hours before release.'}
  ];
  let idx = 0;
  const box = document.getElementById('helpOverlay');
  const title = document.getElementById('helpTitle');
  const body = document.getElementById('helpBody');
  function paint(){ if(!box) return; title.textContent = steps[idx].t; body.textContent = steps[idx].b; }
  window.openHelp = function(){ idx=0; paint(); box.style.display='flex'; };
  window.closeHelp = function(){ if(box) box.style.display='none'; };
  window.nextHelp = function(){ idx = Math.min(steps.length-1, idx+1); paint(); };
  window.prevHelp = function(){ idx = Math.max(0, idx-1); paint(); };
  paint();
}

document.addEventListener('DOMContentLoaded', initCommand);


function isoShort(v){ try{return new Date(v).toLocaleDateString();}catch(e){return '—';} }
function currencyCompact(n){ if(!n) return '$0'; const m=Number(n); if(m>=1000000) return '$'+(m/1000000).toFixed(m%1000000===0?0:2).replace(/\.00$/,'')+'M'; if(m>=1000) return '$'+Math.round(m/1000)+'K'; return '$'+fmtNum(m); }
function daysOnMarket(listing){ const dt = listing.first_seen_at || listing.date_listed; if(!dt) return 0; return Math.max(0, Math.floor((Date.now()-new Date(dt))/86400000)); }
function listingPrimarySignal(l){ const signals = l.internal_signals||[]; return signals[0] || (l.flags?.price_drop ? 'Price reduced recently.' : (l.flags?.below_market ? 'Below area average.' : 'Verified internal listing.')); }
function renderPipelineHealth(data, internalListings, publicListings, internalOnly, leads){
  const wrap=document.getElementById('health-list')||document.getElementById('pipelineHealthList'); if(!wrap) return;
  const sourceRuns=(data.internal.sourceRuns?.runs||[]);
  const rawCount=(data.raw.sourceA||[]).length + (data.raw.sourceB||[]).length + (data.raw.manualUploads||[]).length;
  const unresolved=(data.internal.sourceConflicts||[]).length;
  wrap.innerHTML = [
    ['listing_store', rawCount+' records'],
    ['lead_store', leads.length+' leads'],
    ['deal_engine', internalListings.length+' scored'],
    ['signal_engine', internalListings.reduce((s,l)=>s+(l.internal_signals||[]).length,0)+' signals active'],
    ['price_drop_tracker', internalListings.filter(l=>l.flags&&l.flags.price_drop).length+' drops'],
    ['release_compiler', publicListings.length+' public / '+internalOnly.length+' internal only'],
    ['source_runs', sourceRuns.length+' run log rows'],
    ['conflict_queue', unresolved+' unresolved']
  ].map(([a,b])=>`<div class="sig-item"><div><div class="sig-title">${escapeHtml(a)}</div><div class="sig-desc">${escapeHtml(b)}</div></div></div>`).join('');
}
function renderListingsGridPage(items, benchmarks=null){
  const wrap=document.getElementById('listings-grid')||document.getElementById('listingsGrid'); if(!wrap) return;
  const q=(document.getElementById('f-search')?.value||'').toLowerCase().trim();
  const beds=Number(document.getElementById('f-beds')?.value||0);
  const type=(document.getElementById('f-type')?.value||'').toLowerCase();
  const max=Number(document.getElementById('f-maxprice')?.value||0);
  let sort=(document.querySelector('.sort-pill.active')?.dataset.sort)||'deal_score';
  let rows=[...items];
  rows=rows.filter(l=>!q || `${l.address||''} ${l.city||''} ${l.province||''}`.toLowerCase().includes(q));
  rows=rows.filter(l=>!beds || Number(l.beds||0)>=beds);
  rows=rows.filter(l=>!type || canonicalTypeCategory(l.property_type)===canonicalTypeCategory(type));
  rows=rows.filter(l=>!max || Number(l.list_price||0)<=max);
  rows.sort((a,b)=>{
    if(sort==='price_asc') return Number(a.list_price||0)-Number(b.list_price||0);
    if(sort==='price_desc') return Number(b.list_price||0)-Number(a.list_price||0);
    if(sort==='newest') return new Date(b.last_seen_at||b.first_seen_at||0)-new Date(a.last_seen_at||a.first_seen_at||0);
    return Number(b.deal_score||0)-Number(a.deal_score||0);
  });
  if(!rows.length){ wrap.innerHTML='<div class="empty-box" style="grid-column:1/-1">No listings match the current filters yet. Sync or import sources in Settings first.</div>'; return; }
  wrap.innerHTML = rows.map((l,idx)=>{ const m=listingMarketPosition(l, benchmarks); return `<article class="listing-card ${idx===1?'hero':''}"><div class="listing-body"><div class="mini-tags">${m?.label?`<span class="tag ${m.direction==='below'?'below':(m.direction==='above'?'drop':'new')}">${escapeHtml(m.label)}</span>`:''}${GRR.badgeTags(l).map(t=>`<span class="tag ${t[1]}">${t[0]}</span>`).join(' ')}${(l.conflict_count||0)>0?'<span class="tag red">Conflict</span>':''}</div></div><div class="listing-media">${window.GPSFallbackMap ? GPSFallbackMap.listingThumbnailHtml(l, {provider:'dark'}) : '🏠'}</div><div class="listing-body"><div class="price-line">${escapeHtml(currencyCompact(l.list_price))}</div><div class="addr-line">${escapeHtml(l.address||'')}</div><div class="meta-line">${escapeHtml(l.city||'')}, ${escapeHtml(l.province||'')}${m?.label ? ` · ${escapeHtml(m.label)}` : ''}</div><div class="signal-box">• ${escapeHtml(listingPrimarySignal(l))}</div><div class="bottom-meta"><span>${fmtNum(l.beds)} bed · ${fmtNum(l.baths)} bath · ${fmtNum(l.sqft)} sqft</span><span>${daysOnMarket(l)}d</span></div></div></article>`; }).join('');
}
function renderLeadCardsPage(items){
  const wrap=document.getElementById('leads-stack')||document.getElementById('leadCards'); if(!wrap) return;
  const active=(document.querySelector('.lead-tab.active')?.dataset.leadFilter)||'all';
  const rows=items.filter(l=>active==='all' || (l.score_band||scoreBand(l.deal_score||0))===active);
  setText('lt-all', items.length); setText('lt-hot', items.filter(l=>(l.score_band||scoreBand(l.deal_score||0))==='hot').length); setText('lt-warm', items.filter(l=>(l.score_band||scoreBand(l.deal_score||0))==='warm').length); setText('lt-cold', items.filter(l=>(l.score_band||scoreBand(l.deal_score||0))==='cold').length);
  if(!rows.length){ wrap.innerHTML='<div class="empty-box">No leads in this queue yet.</div>'; return; }
  wrap.innerHTML = rows.map(l=>{ const band=(l.score_band||scoreBand(l.deal_score||0)); return `<article class="lead-card ${band}"><div class="lead-main"><div class="lead-ring ${band}">${escapeHtml((l.name||'?')[0])}</div><div><div class="lead-name">${escapeHtml(l.name||'Unnamed')}</div><div class="lead-meta">${l.phone?`<span>📞 ${escapeHtml(l.phone)}</span>`:''}${l.email?`<span>✉ ${escapeHtml(l.email)}</span>`:''}<span>${escapeHtml(l.source||'website')}</span><span>${escapeHtml(l.created_at?isoShort(l.created_at):'new')}</span></div><div class="lead-pill-row">${l.preapproved?'<span class="tag green">✓ Pre-Approved</span>':''}${l.budget?`<span class="tag gold">${escapeHtml(l.budget)}</span>`:''}${l.beds_min?`<span class="tag blue">${fmtNum(l.beds_min)}+ bed</span>`:''}${l.market?`<span class="tag gray">${escapeHtml(l.market)}</span>`:''}${l.timeline?`<span class="tag gray">${escapeHtml(l.timeline)}</span>`:''}</div><div class="lead-note">“${escapeHtml(l.notes || l.intent || 'No notes yet.')}”</div></div><div class="lead-actions"><button class="tab-btn">${l.phone&&l.phone!=='—'?'Call':'Email'}</button><button class="tab-btn">Delete</button></div></div><div class="lead-footer">${band==='hot'?'Call within 1 hour — hot lead':(band==='warm'?'Follow up within 24 hours':'Low urgency / nurture queue')}</div></article>`; }).join('');
}
async function initCommandV12(){
  try {
  const data = await GRR.loadData();
  const state = GRR.loadState();
  const internalListings = data.internal.canonicalListings || [];
  /* Use released listings directly — skip expensive getPublicListings clone */
  const publicListings = data.public.releasedListings || [];
  const publicIds = new Set(publicListings.map(l=>l.id));
  const internalOnly = internalListings.filter(l=>!publicIds.has(l.id));
  const marketBench = buildMarketBenchmarks(internalListings.length ? internalListings : publicListings);
  const leads = (data.internal.leads || []).concat((state.inquiries||[]).map(i => ({name:i.name,email:i.email,phone:i.phone||'—',score_band:i.score_band||'warm',timeline:i.timeline||'new',notes:i.notes,source:i.source||'website',market:i.market||'',budget:i.budget||'',intent:i.intent||'inquiry',created_at:i.created_at||'',preapproved:i.preapproved||false,beds_min:i.beds_min||''})));
  const topDeal = internalListings.length ? Math.max(...internalListings.map(l => Number(l.deal_score||0))) : 0;
  /* Stats — IDs match command-center.html */
  setText('s-hot', leads.filter(l=> (l.score_band||scoreBand(l.deal_score||0)) === 'hot').length);
  setText('s-warm', leads.filter(l=> (l.score_band||scoreBand(l.deal_score||0)) === 'warm').length);
  setText('s-active', internalListings.length);
  setText('s-top', topDeal ? topDeal : '—');
  setText('s-drops', internalListings.filter(l=>l.flags && l.flags.price_drop).length);
  setText('s-today', leads.filter(l=>{ if(!l.created_at) return false; return (Date.now()-new Date(l.created_at))/86400000 < 1; }).length+' new today');
  setText('s-total-leads', leads.length+' total leads');
  setText('s-props', internalListings.length+' properties');
  const dd=document.getElementById('dash-date'); if(dd) dd.textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  renderWhoToCall(leads); renderTopDeals(internalListings, marketBench); renderSignals(internalListings); renderPipelineHealth(data, internalListings, publicListings, internalOnly, leads); renderListingsGridPage(internalListings.length?internalListings:publicListings, marketBench); renderLeadCardsPage(leads); setupHelp();
  document.querySelectorAll('.sort-pill').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.sort-pill').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); renderListingsGridPage(internalListings.length?internalListings:publicListings, marketBench);});
  ['f-search','f-beds','f-type','f-maxprice'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',()=>renderListingsGridPage(internalListings.length?internalListings:publicListings, marketBench)); if(el) el.addEventListener('change',()=>renderListingsGridPage(internalListings.length?internalListings:publicListings, marketBench));});
  document.querySelectorAll('.lead-tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.lead-tab').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); renderLeadCardsPage(leads);});
  } catch(err) { console.error('initCommandV12 error:', err); document.getElementById('dash-date').textContent = 'Error: ' + err.message; }
}
document.removeEventListener('DOMContentLoaded', initCommand);
document.addEventListener('DOMContentLoaded', initCommandV12);
