const CONNECTOR_KEY = 'grr_api_connectors_v1';
const RUNLOG_KEY = 'grr_api_runs_v1';
const LOCAL_ONLY_MODE = true;
const SOURCE_CLASSES = ['confirmed_listing_feed','mls_partner_feed','municipal_public_record','assessor_record','broker_submission','manual_upload','unclassified'];
const TIERS = ['A','B','C'];
const DEFAULT_CONNECTORS = [
  {
    name:'Listings API A',
    enabled:false,
    endpoint:'',
    bucket:'source_a',
    method:'GET',
    arrayPath:'',
    authHeader:'',
    authValue:'',
    mode:'replace',
    source_class:'confirmed_listing_feed',
    authority_tier:'A',
    mapJson:'',
    notes:'Primary market-live feed for listing price/status freshness.'
  },
  {
    name:'Listings API B',
    enabled:false,
    endpoint:'',
    bucket:'source_b',
    method:'GET',
    arrayPath:'',
    authHeader:'',
    authValue:'',
    mode:'replace',
    source_class:'municipal_public_record',
    authority_tier:'B',
    mapJson:'',
    notes:'Secondary source for baseline property facts and reconciliation.'
  },
  {
    name:'Manual JSON Endpoint',
    enabled:false,
    endpoint:'',
    bucket:'manual_uploads',
    method:'GET',
    arrayPath:'',
    authHeader:'',
    authValue:'',
    mode:'append',
    source_class:'manual_upload',
    authority_tier:'C',
    mapJson:'',
    notes:'Use for hosted JSON packs, ad-hoc files, and manual validation input.'
  }
];
const HELP_STEPS = [
  {title:'Settings controls intake.', body:'Use this page to configure local intake metadata, source classification, and field maps for non-stock real estate sources.'},
  {title:'Tag each source by trust tier.', body:'Assign authority tier A/B/C and source class so provenance can score freshness and confidence per field.'},
  {title:'Import into raw buckets first.', body:'In local-only mode, ingest JSON files through Import Source. Nothing reaches public pages until reconcile + compile.'},
  {title:'Reconcile creates canonical listings.', body:'Reconcile merges records, surfaces conflicts, and computes field-level provenance + stale flags for command center review.'}
];

let helpStep = 0;
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function safeTier(v){ const t = String(v||'').toUpperCase(); return TIERS.includes(t) ? t : 'C'; }
function safeSourceClass(v){ return SOURCE_CLASSES.includes(v) ? v : 'unclassified'; }
function withDefaults(c, idx){
  const d = DEFAULT_CONNECTORS[idx] || DEFAULT_CONNECTORS[DEFAULT_CONNECTORS.length-1];
  return {
    name: c?.name || d.name || `Connector ${idx+1}`,
    enabled: !!c?.enabled,
    endpoint: c?.endpoint || '',
    bucket: c?.bucket || d.bucket || 'manual_uploads',
    method: c?.method || 'GET',
    arrayPath: c?.arrayPath || '',
    authHeader: c?.authHeader || '',
    authValue: c?.authValue || '',
    mode: c?.mode || 'replace',
    source_class: safeSourceClass(c?.source_class || d.source_class),
    authority_tier: safeTier(c?.authority_tier || d.authority_tier),
    mapJson: c?.mapJson || '',
    notes: c?.notes || ''
  };
}
function loadConnectors(){
  try{
    const raw = JSON.parse(localStorage.getItem(CONNECTOR_KEY)||'null');
    if(!Array.isArray(raw) || !raw.length) return clone(DEFAULT_CONNECTORS);
    return raw.map((c,idx)=>withDefaults(c, idx));
  }catch(e){ return clone(DEFAULT_CONNECTORS); }
}
function saveConnectors(items){ localStorage.setItem(CONNECTOR_KEY, JSON.stringify(items.map((c,idx)=>withDefaults(c, idx)))); return items; }
function loadRuns(){ try{ return JSON.parse(localStorage.getItem(RUNLOG_KEY)||'[]'); }catch(e){ return []; } }
function saveRuns(items){ localStorage.setItem(RUNLOG_KEY, JSON.stringify(items.slice(0,40))); }
function addRun(run){ const items=loadRuns(); items.unshift(Object.assign({at:new Date().toISOString()},run)); saveRuns(items); renderRunLog(); renderKpis(); }
function localOnlyGuard(action='sync'){
  if (!LOCAL_ONLY_MODE) return false;
  addRun({ type:action, connector:'local_only_guard', ok:false, bucket:'manual_uploads', records:0, note:'Local-only mode blocks remote endpoint calls. Use Import Source Files.' });
  alert('Local-only mode is enabled. Use Import Source Files for JSON intake, then Reconcile + Compile.');
  return true;
}
function openImportTool(){ location.href='tools/import-source.html'; }
function exportConnectorConfig(){ const blob = new Blob([JSON.stringify(loadConnectors(), null, 2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='grr_api_connectors.json'; a.click(); URL.revokeObjectURL(a.href); }
function exportPipelineSnapshot(){
  const blob = new Blob([JSON.stringify(GRR.loadPipeline(), null, 2)], {type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='grr_pipeline_snapshot.json';
  a.click();
  URL.revokeObjectURL(a.href);
  addRun({ type:'export', connector:'pipeline', ok:true, bucket:'pipeline', records:GRR.pipelineSummary().canonical, note:'Pipeline snapshot exported.' });
}
function resetPipelineState(){
  if(!confirm('Reset the local pipeline state? This clears raw, internal, and public compiled data from local storage.')) return;
  GRR.clearPipeline();
  addRun({ type:'pipeline_reset', connector:'pipeline', ok:true, bucket:'pipeline', records:0, note:'Local pipeline state reset.' });
  renderKpis();
}
function resetApiRuns(){ if(!confirm('Clear the connector run log?')) return; localStorage.removeItem(RUNLOG_KEY); renderRunLog(); renderKpis(); }
function getByPath(obj, path){ if(!path) return obj; return path.split('.').filter(Boolean).reduce((acc,key)=>acc && acc[key], obj); }
function safeJsonParse(txt, fallback){ try{return JSON.parse(txt);}catch(e){ return fallback; } }
function asArray(payload, path){ const base = path ? getByPath(payload, path) : payload; if(Array.isArray(base)) return base; if(Array.isArray(base?.results)) return base.results; if(Array.isArray(base?.listings)) return base.listings; if(Array.isArray(base?.items)) return base.items; if(Array.isArray(base?.data)) return base.data; return []; }
function pick(record, keys){ for(const key of keys){ const value = getByPath(record, key); if(value !== undefined && value !== null && value !== '') return value; } return ''; }
function buildFieldMap(connector){
  const user = safeJsonParse(connector.mapJson || '{}', {});
  return {
    listing_id:[user.listing_id||'listing_id','id','mls','mls_number','property.id'],
    address:[user.address||'address','full_address','location.address','property.address','street_address'],
    city:[user.city||'city','location.city','municipality'],
    province:[user.province||'province','state','location.province'],
    postal_code:[user.postal_code||'postal_code','zip','postcode','location.postal_code'],
    list_price:[user.list_price||'list_price','price','listPrice','pricing.list'],
    beds:[user.beds||'beds','bedrooms','details.beds'],
    baths:[user.baths||'baths','bathrooms','details.baths'],
    sqft:[user.sqft||'sqft','square_feet','area','details.sqft'],
    property_type:[user.property_type||'property_type','type','property.type'],
    status:[user.status||'status','listing_status','property.status'],
    description:[user.description||'description','remarks','public_remarks'],
    url:[user.url||'url','listing_url','href'],
    photos:[user.photos||'photos','images','media'],
    first_seen_at:[user.first_seen_at||'first_seen_at','created_at','listed_at','date_listed'],
    last_seen_at:[user.last_seen_at||'last_seen_at','updated_at','modified_at']
  };
}
function normalizeRecord(record, connector){
  const map = buildFieldMap(connector);
  const out = {};
  Object.keys(map).forEach(key => out[key] = pick(record, Array.isArray(map[key]) ? map[key] : [map[key]]));
  out.source_name = connector.name;
  out.source_class = safeSourceClass(connector.source_class);
  out.authority_tier = safeTier(connector.authority_tier);
  out.raw_endpoint = connector.endpoint;
  out.list_price = Number(String(out.list_price||'').replace(/[^\d.]/g,'')) || 0;
  out.beds = Number(out.beds||0) || 0;
  out.baths = Number(out.baths||0) || 0;
  out.sqft = Number(String(out.sqft||'').replace(/[^\d.]/g,'')) || 0;
  out.images = Array.isArray(out.photos) ? out.photos : (out.photos ? [out.photos] : []);
  out.listing_id = out.listing_id || out.address || ('raw_'+Math.random().toString(36).slice(2,10));
  out.first_seen_at = out.first_seen_at || new Date().toISOString();
  out.last_seen_at = out.last_seen_at || new Date().toISOString();
  out.fetched_at = new Date().toISOString();
  return out;
}
async function testConnector(idx){
  if (localOnlyGuard('test')) return;
  const connector = loadConnectors()[idx];
  if(!connector.endpoint){ alert('Add an endpoint first.'); return; }
  try{
    const headers = {}; if(connector.authHeader && connector.authValue) headers[connector.authHeader] = connector.authValue;
    const res = await fetch(connector.endpoint, { method: connector.method || 'GET', headers });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const payload = await res.json(); const arr = asArray(payload, connector.arrayPath);
    addRun({ type:'test', connector:connector.name, ok:true, bucket:connector.bucket, records:arr.length, note:`Endpoint reachable (${connector.authority_tier}/${connector.source_class}).` });
    alert(`Connector test passed. Found ${arr.length} record(s).`);
  }catch(err){ addRun({ type:'test', connector:connector.name, ok:false, bucket:connector.bucket, records:0, note:String(err) }); alert('Connector test failed: '+ err); }
}
function updateConnectorFromDom(idx){
  const items = loadConnectors();
  const root = document.getElementById('connector-'+idx);
  items[idx] = withDefaults({
    name: root.querySelector('[data-k="name"]').value.trim() || `Connector ${idx+1}`,
    enabled: root.querySelector('[data-k="enabled"]').value === 'true',
    endpoint: root.querySelector('[data-k="endpoint"]').value.trim(),
    bucket: root.querySelector('[data-k="bucket"]').value,
    method: root.querySelector('[data-k="method"]').value,
    arrayPath: root.querySelector('[data-k="arrayPath"]').value.trim(),
    authHeader: root.querySelector('[data-k="authHeader"]').value.trim(),
    authValue: root.querySelector('[data-k="authValue"]').value.trim(),
    mode: root.querySelector('[data-k="mode"]').value,
    source_class: root.querySelector('[data-k="source_class"]').value,
    authority_tier: root.querySelector('[data-k="authority_tier"]').value,
    mapJson: root.querySelector('[data-k="mapJson"]').value.trim(),
    notes: root.querySelector('[data-k="notes"]').value.trim()
  }, idx);
  saveConnectors(items); renderConnectors(); renderKpis(); return items[idx];
}
function saveConnector(idx){ updateConnectorFromDom(idx); addRun({ type:'save', connector:loadConnectors()[idx].name, ok:true, bucket:loadConnectors()[idx].bucket, records:0, note:'Connector saved.' }); }
async function syncConnector(idx){
  if (localOnlyGuard('sync')) return;
  const connector = updateConnectorFromDom(idx);
  if(!connector.enabled){ alert('Enable the connector first.'); return; }
  if(!connector.endpoint){ alert('Add an endpoint first.'); return; }
  try{
    const headers = {}; if(connector.authHeader && connector.authValue) headers[connector.authHeader] = connector.authValue;
    const res = await fetch(connector.endpoint, { method: connector.method || 'GET', headers }); if(!res.ok) throw new Error('HTTP '+res.status);
    const payload = await res.json();
    const arr = asArray(payload, connector.arrayPath);
    const normalized = arr.map(r => normalizeRecord(r, connector));
    if(connector.mode === 'append') GRR.mergeRawSource(connector.bucket, normalized); else GRR.importRawSource(connector.bucket, normalized);
    addRun({ type:'sync', connector:connector.name, ok:true, bucket:connector.bucket, records:normalized.length, note:`Loaded into ${connector.bucket} (${connector.mode}) as ${connector.authority_tier}/${connector.source_class}.` });
    renderKpis(); alert(`Synced ${normalized.length} normalized record(s) into ${connector.bucket}.`);
  }catch(err){ addRun({ type:'sync', connector:connector.name, ok:false, bucket:connector.bucket, records:0, note:String(err) }); alert('Sync failed: ' + err); }
}
async function syncAllApis(){ if (localOnlyGuard('sync_all')) return; const connectors = loadConnectors().map((c,i)=>[c,i]).filter(([c])=>c.enabled && c.endpoint); if(!connectors.length){ alert('No enabled connectors with endpoints are configured yet.'); return; } for(const [,i] of connectors){ await syncConnector(i); } }
function runReconcile(){ GRR.runPipeline(); addRun({ type:'pipeline', connector:'internal pipeline', ok:true, bucket:'internal/public', records:GRR.pipelineSummary().canonical, note:'Reconcile + compile completed.' }); renderKpis(); alert('Reconcile + compile completed. Open the dashboard or public pages next.'); }
function renderKpis(){
  const summary = GRR.pipelineSummary();
  const runs = loadRuns();
  const connectors = loadConnectors();
  const tierA = connectors.filter(c=>c.enabled && c.authority_tier==='A').length;
  document.getElementById('kpis').innerHTML = `<div class="box"><div class="l">Enabled connectors</div><div class="n">${connectors.filter(c=>c.enabled).length}</div></div><div class="box"><div class="l">Tier A live sources</div><div class="n">${tierA}</div></div><div class="box"><div class="l">Raw records</div><div class="n">${summary.rawCount}</div></div><div class="box"><div class="l">Canonical listings</div><div class="n">${summary.canonical}</div></div><div class="box"><div class="l">Public released</div><div class="n">${summary.released}</div></div><div class="box"><div class="l">Connector runs</div><div class="n">${runs.length}</div></div>`;
}
function connectorStatus(connector){
  if(LOCAL_ONLY_MODE) return {text:'local-only import mode', cls:'ok'};
  if(!connector.endpoint) return {text:'not configured', cls:'warn'};
  if(!connector.enabled) return {text:'saved but disabled', cls:''};
  return {text:`ready · ${connector.authority_tier}/${connector.source_class}`, cls:'ok'};
}
function renderConnectors(){
  const items = loadConnectors();
  document.getElementById('connectorList').innerHTML = items.map((c,idx)=>{
    const st = connectorStatus(c);
    return `<div class="connector" id="connector-${idx}">
      <div class="connector-head">
        <div>
          <div style="font-weight:800;font-size:18px">${escapeHtml(c.name || 'Connector '+(idx+1))}</div>
          <div class="mini" style="margin-top:5px">${escapeHtml(c.notes || '')}</div>
        </div>
        <div class="pill ${st.cls}">${st.text}</div>
      </div>
      <div class="row">
        <div class="field"><label>Name</label><input data-k="name" value="${escapeHtml(c.name||'')}"></div>
        <div class="field"><label>Endpoint URL</label><input data-k="endpoint" value="${escapeHtml(c.endpoint||'')}" placeholder="${LOCAL_ONLY_MODE ? 'Local-only mode: use Import Source Files' : 'https://example.com/listings.json'}" ${LOCAL_ONLY_MODE ? 'disabled' : ''}></div>
      </div>
      <div class="row4">
        <div class="field"><label>Enabled</label><select data-k="enabled"><option value="false" ${!c.enabled?'selected':''}>Off</option><option value="true" ${c.enabled?'selected':''}>On</option></select></div>
        <div class="field"><label>Bucket</label><select data-k="bucket"><option value="source_a" ${c.bucket==='source_a'?'selected':''}>source_a</option><option value="source_b" ${c.bucket==='source_b'?'selected':''}>source_b</option><option value="manual_uploads" ${c.bucket==='manual_uploads'?'selected':''}>manual_uploads</option></select></div>
        <div class="field"><label>Method</label><select data-k="method"><option ${c.method==='GET'?'selected':''}>GET</option></select></div>
        <div class="field"><label>Mode</label><select data-k="mode"><option value="replace" ${c.mode==='replace'?'selected':''}>replace</option><option value="append" ${c.mode==='append'?'selected':''}>append</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label>Source class</label><select data-k="source_class">${SOURCE_CLASSES.map(v=>`<option value="${v}" ${c.source_class===v?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Authority tier</label><select data-k="authority_tier">${TIERS.map(v=>`<option value="${v}" ${c.authority_tier===v?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="row3">
        <div class="field"><label>Array path</label><input data-k="arrayPath" value="${escapeHtml(c.arrayPath||'')}" placeholder="results.listings"></div>
        <div class="field"><label>Auth header</label><input data-k="authHeader" value="${escapeHtml(c.authHeader||'')}" placeholder="Authorization"></div>
        <div class="field"><label>Auth value</label><input data-k="authValue" value="${escapeHtml(c.authValue||'')}" placeholder="Bearer ..."></div>
      </div>
      <div class="field"><label>Optional field-map JSON</label><textarea data-k="mapJson" placeholder='{"address":"property.address","list_price":"pricing.list"}'>${escapeHtml(c.mapJson||'')}</textarea></div>
      <div class="field"><label>Notes</label><input data-k="notes" value="${escapeHtml(c.notes||'')}"></div>
      <div class="connector-actions">
        <button class="btn ghost" onclick="saveConnector(${idx})">Save</button>
        <button class="btn ghost" onclick="testConnector(${idx})" ${LOCAL_ONLY_MODE ? 'disabled' : ''}>Test</button>
        <button class="btn gold" onclick="syncConnector(${idx})" ${LOCAL_ONLY_MODE ? 'disabled' : ''}>Sync Now</button>
      </div>
    </div>`;
  }).join('');
}
function renderRunLog(){ const items = loadRuns(); document.getElementById('runLog').innerHTML = items.length ? items.map(r => `<div class="log-row"><div><b>${escapeHtml(r.connector||'connector')}</b><div class="mini">${escapeHtml(r.type||'run')} · ${escapeHtml(r.bucket||'')} · ${r.records||0} records</div></div><div style="text-align:right"><div class="pill ${r.ok===false?'warn':'ok'}">${r.ok===false?'failed':'ok'}</div><div class="mini" style="margin-top:6px">${escapeHtml(r.at||'')}</div></div><div class="log-note">${escapeHtml(r.note||'')}</div></div>`).join('') : '<div class="empty-box">No connector runs yet.</div>'; }
function renderSecurityPolicy(){
  const status = document.getElementById('secStatus');
  if (!status) return;
  if (!window.GRRAuth){
    status.textContent = 'Auth module unavailable.';
    return;
  }
  const policy = window.GRRAuth.loadPolicy();
  const session = window.GRRAuth.getSession();
  const enabledEl = document.getElementById('secEnabled');
  const minutesEl = document.getElementById('secSessionMinutes');
  const passEl = document.getElementById('secPasscode');
  const pass2El = document.getElementById('secPasscodeConfirm');
  if (enabledEl) enabledEl.value = String(!!policy.enabled);
  if (minutesEl) minutesEl.value = Number(policy.session_minutes || 480);
  if (passEl) passEl.value = '';
  if (pass2El) pass2El.value = '';
  status.innerHTML = policy.enabled
    ? `Access lock: <b>enabled</b> · Session: <b>${Number(policy.session_minutes || 480)} min</b> · Active session: <b>${session ? `${session.role} (${escapeHtml(session.name || 'operator')})` : 'none'}</b>`
    : 'Access lock: <b>disabled</b>.';
}
async function saveSecurityPolicy(){
  if (!window.GRRAuth){ alert('Auth module unavailable.'); return; }
  const enabled = document.getElementById('secEnabled')?.value === 'true';
  const session_minutes = Number(document.getElementById('secSessionMinutes')?.value || 480) || 480;
  const passcode = document.getElementById('secPasscode')?.value || '';
  const confirmPasscode = document.getElementById('secPasscodeConfirm')?.value || '';
  if (passcode || confirmPasscode){
    if (passcode !== confirmPasscode){ alert('Passcode confirmation does not match.'); return; }
    if (passcode.length < 4){ alert('Passcode must be at least 4 characters.'); return; }
  }
  const out = await window.GRRAuth.configurePolicy({ enabled, session_minutes, passcode });
  if (!out.ok){ alert(out.message || 'Failed to update security policy.'); return; }
  addRun({ type:'security', connector:'access_control', ok:true, bucket:'settings', records:0, note:`Access lock ${enabled ? 'enabled' : 'disabled'} (${session_minutes} min session).` });
  renderSecurityPolicy();
  alert('Access control settings saved.');
}
function clearSecuritySession(){
  if (!window.GRRAuth){ alert('Auth module unavailable.'); return; }
  window.GRRAuth.clearSession();
  addRun({ type:'security', connector:'access_control', ok:true, bucket:'settings', records:0, note:'Local access session cleared.' });
  renderSecurityPolicy();
  alert('Current access session cleared.');
}
function paintHelp(){ const s = HELP_STEPS[helpStep]; document.getElementById('helpTitle').textContent = s.title; document.getElementById('helpBody').textContent = s.body; }
function openSettingsHelp(){ helpStep=0; paintHelp(); document.getElementById('settingsHelp').style.display='flex'; }
function closeSettingsHelp(){ document.getElementById('settingsHelp').style.display='none'; }
function nextSettingsHelp(){ helpStep = Math.min(HELP_STEPS.length-1, helpStep+1); paintHelp(); }
function prevSettingsHelp(){ helpStep = Math.max(0, helpStep-1); paintHelp(); }
function initSettings(){ renderKpis(); renderConnectors(); renderRunLog(); renderSecurityPolicy(); paintHelp(); }
document.addEventListener('DOMContentLoaded', initSettings);
