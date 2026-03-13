
window.GRRResolver = (function(){
  const DEFAULT_SOURCE_PROFILES = {
    source_a:{ source_name:'Source A', source_class:'municipal_public_record', authority_tier:'B' },
    source_b:{ source_name:'Source B', source_class:'municipal_public_record', authority_tier:'B' },
    manual_uploads:{ source_name:'Manual Upload', source_class:'manual_upload', authority_tier:'C' }
  };
  const FIELD_TTL_HOURS = {
    address:24*365, city:24*365, province:24*365, postal_code:24*365,
    property_type:24*30, beds:24*30, baths:24*30, sqft:24*30, year_built:24*365,
    list_price:24, status:12, days_on_market:24, description:24*14
  };
  const TIER_CONFIDENCE = { A:0.95, B:0.82, C:0.68 };
  const CRITICAL_FIELDS = ['list_price','status'];

  function slugify(v=''){ return String(v).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function toNum(v, fallback=0){ const n = Number(String(v ?? '').replace(/[^\d.\-]/g,'')); return Number.isFinite(n) ? n : fallback; }
  function nowIso(){ return new Date().toISOString(); }
  function toIso(v){ const d = new Date(v || Date.now()); return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString(); }
  function diffHours(fromIso, toIsoValue){ return (new Date(toIsoValue).getTime() - new Date(fromIso).getTime()) / 3600000; }
  function tierConfidence(tier){ return TIER_CONFIDENCE[String(tier||'').toUpperCase()] || 0.68; }
  function ttlForField(field){ return FIELD_TTL_HOURS[field] || (24*30); }
  function normTier(v){ const t = String(v||'').trim().toUpperCase(); return ['A','B','C'].includes(t) ? t : ''; }
  function normProvince(v=''){
    const map = { 'BRITISH COLUMBIA':'BC','BC':'BC','ALBERTA':'AB','AB':'AB','SASKATCHEWAN':'SK','SK':'SK','MANITOBA':'MB','MB':'MB','ONTARIO':'ON','ON':'ON','QUEBEC':'QC','QC':'QC','NEW BRUNSWICK':'NB','NB':'NB','NOVA SCOTIA':'NS','NS':'NS','PRINCE EDWARD ISLAND':'PE','PE':'PE','NEWFOUNDLAND AND LABRADOR':'NL','NL':'NL','YUKON':'YT','YT':'YT','NORTHWEST TERRITORIES':'NT','NT':'NT','NUNAVUT':'NU','NU':'NU' };
    return map[String(v||'').trim().toUpperCase()] || String(v||'').trim().toUpperCase();
  }
  function resolveSourceProfile(record={}, source='manual_uploads'){
    const base = DEFAULT_SOURCE_PROFILES[source] || { source_name:source, source_class:'unclassified', authority_tier:'C' };
    const tier = normTier(record.authority_tier) || base.authority_tier;
    return {
      source_name: record.source_name || base.source_name,
      source_class: record.source_class || base.source_class,
      authority_tier: tier
    };
  }
  function valuePresent(v){ return !(v === undefined || v === null || v === ''); }
  function freshness(capturedAt, ttlHours){
    const captured = toIso(capturedAt);
    const ageHours = Math.max(0, diffHours(captured, nowIso()));
    return { captured_at:captured, ttl_hours:ttlHours, age_hours:Math.round(ageHours*10)/10, is_stale: ageHours > ttlHours };
  }
  function normalizeSourceRecord(record={}, source='manual_uploads'){
    const profile = resolveSourceProfile(record, source);
    const address = record.address || record.address_full || record.street_address || '';
    const city = record.city || record.municipality || '';
    const province = normProvince(record.province || record.prov || record.region || '');
    const postal = record.postal_code || record.postal || '';
    const price = toNum(record.list_price || record.price || record.asking_price);
    const beds = toNum(record.beds || record.bedrooms);
    const baths = toNum(record.baths || record.bathrooms);
    const sqft = toNum(record.sqft || record.square_feet || record.interior_sqft);
    const lot_size = record.lot_size || '';
    const property_type = record.property_type || record.type || 'House';
    const status = String(record.status || 'active').toLowerCase();
    const dom = toNum(record.days_on_market || record.dom);
    const description = record.description || record.remarks || '';
    const fetched = toIso(record.fetched_at || nowIso());
    const firstSeen = toIso(record.first_seen_at || fetched);
    const source_id = record.source_record_id || record.record_id || record.mls || record.listing_id || `${source}-${slugify(address)}-${slugify(city)}-${slugify(province)}`;
    const key = [slugify(address), slugify(city), province, String(Math.round(price/5000)*5000)].join('|');
    return {
      source,
      source_name: profile.source_name,
      source_class: profile.source_class,
      authority_tier: profile.authority_tier,
      source_record_id: source_id,
      source_url: record.url || record.source_url || '',
      listing_key: key,
      address,
      city,
      province,
      postal_code: postal,
      lat: record.lat || '',
      lng: record.lng || '',
      property_type,
      beds,
      baths,
      sqft,
      lot_size,
      year_built: toNum(record.year_built) || '',
      list_price: price,
      status,
      days_on_market: dom,
      description,
      images: Array.isArray(record.images) ? record.images : [],
      fetched_at: fetched,
      first_seen_at: firstSeen,
      last_seen_at: fetched,
      raw: record
    };
  }
  // Quick heuristic scoring for initial triage during reconciliation.
  // Produces integer 1–99 (stored as deal_score).
  // The listings UI re-scores with the weighted computeScore (0–1 float)
  // for detailed display, so this value is primarily used by command.js
  // and the Python pipeline where the detailed breakdown is not needed.
  function scoreListing(rec){
    const price = rec.list_price || 0;
    const sqft = rec.sqft || 0;
    const ppsf = sqft ? price / sqft : 9999;
    let score = 34;
    const flags = { price_drop:false, below_market:false, new_listing:false, investor:false, fixer:false };
    if (rec.days_on_market <= 7) { score += 8; flags.new_listing = true; }
    if (rec.days_on_market >= 45) score += 7;
    if (ppsf && ppsf < 330) { score += 14; flags.below_market = true; }
    if (rec.list_price && rec.list_price < 650000) score += 6;
    if ((rec.description || '').toLowerCase().match(/fixer|handyman|reno|sweat equity/)) { score += 9; flags.fixer = true; }
    if (rec.beds >= 3 && rec.baths >= 2) score += 5;
    if ((rec.property_type || '').toLowerCase().includes('multi') || (rec.description || '').toLowerCase().includes('suite')) { score += 7; flags.investor = true; }
    score = Math.max(1, Math.min(99, Math.round(score)));
    return { score, flags, ppsf: ppsf ? Math.round(ppsf) : null };
  }
  function mergeGroup(records=[]){
    const sorted = [...records].sort((a,b)=> new Date(b.fetched_at) - new Date(a.fetched_at));
    const latest = sorted[0] || {};
    const vals = field => [...new Set(sorted.map(r => JSON.stringify(r[field] ?? '') ))].map(v=>JSON.parse(v));
    const conflicts = [];
    ['list_price','beds','baths','sqft','status','property_type'].forEach(field => {
      const set = vals(field);
      if (set.length > 1) {
        conflicts.push({
          listing_key: latest.listing_key,
          address: latest.address,
          city: latest.city,
          province: latest.province,
          field,
          values: sorted.map(r => ({ source:r.source, source_name:r.source_name, authority_tier:r.authority_tier, value:r[field] ?? '' })),
          canonical_value: latest[field],
          status: 'review',
          resolution: 'latest_source_wins_pending_review'
        });
      }
    });
    const scored = scoreListing(latest);
    const id = 'LST-' + slugify(latest.address).slice(0,28) + '-' + slugify(latest.city).slice(0,18);
    const conflictFields = new Set(conflicts.map(c => c.field));
    const provenanceFields = ['address','city','province','postal_code','property_type','beds','baths','sqft','year_built','list_price','status','days_on_market','description'];
    const field_provenance = {};
    provenanceFields.forEach(field => {
      const rec = sorted.find(r => valuePresent(r[field])) || latest;
      const fresh = freshness(rec.fetched_at || latest.fetched_at, ttlForField(field));
      const hasConflict = conflictFields.has(field);
      const confidence = Math.max(0.3, Math.min(0.99, tierConfidence(rec.authority_tier) - (fresh.is_stale ? 0.18 : 0) - (hasConflict ? 0.15 : 0)));
      field_provenance[field] = {
        value: valuePresent(rec[field]) ? rec[field] : '',
        source: rec.source || '',
        source_name: rec.source_name || rec.source || '',
        source_class: rec.source_class || 'unclassified',
        authority_tier: rec.authority_tier || 'C',
        captured_at: fresh.captured_at,
        ttl_hours: fresh.ttl_hours,
        age_hours: fresh.age_hours,
        stale: fresh.is_stale,
        confidence: Math.round(confidence*100)/100
      };
    });
    const staleFields = Object.entries(field_provenance).filter(([,v]) => v.stale).map(([k]) => k);
    const criticalStale = CRITICAL_FIELDS.some(f => field_provenance[f]?.stale);
    const sourceTiers = [...new Set(sorted.map(r => r.authority_tier || 'C'))].sort();
    const trustScore = Math.round((Object.values(field_provenance).reduce((s,p)=>s + (p.confidence || 0), 0) / Math.max(1, Object.keys(field_provenance).length)) * 100);
    return {
      id,
      listing_id: id,
      address: latest.address,
      address_full: latest.address,
      address_normalized: latest.address,
      city: latest.city,
      province: latest.province,
      postal_code: latest.postal_code,
      lat: latest.lat,
      lng: latest.lng,
      property_type: latest.property_type,
      beds: latest.beds,
      baths: latest.baths,
      sqft: latest.sqft,
      lot_size: latest.lot_size,
      year_built: latest.year_built,
      list_price: latest.list_price,
      price_label: Number(latest.list_price || 0).toLocaleString(),
      status: 'verified_internal',
      canonical_status: latest.status,
      days_on_market: latest.days_on_market,
      description: latest.description,
      images: latest.images,
      first_seen_at: sorted[sorted.length-1]?.first_seen_at || latest.first_seen_at,
      last_seen_at: latest.last_seen_at,
      fetched_at: latest.fetched_at,
      public_eligible: false,
      public_released_at: '',
      instant_update_mode: false,
      verification_status: 'verified_internal',
      internal_gate_note: conflicts.length
        ? `Source inconsistencies noted across ${conflicts.length} field${conflicts.length===1?'':'s'}. Canonical value currently follows latest source until reviewed.`
        : (criticalStale ? 'Critical market fields are stale and should be refreshed before public release.' : 'Verified internally with no current field conflicts.'),
      source_records: sorted.map(r => ({ source:r.source, source_name:r.source_name, source_class:r.source_class, authority_tier:r.authority_tier, source_record_id:r.source_record_id, source_url:r.source_url, fetched_at:r.fetched_at })),
      source_conflicts: conflicts,
      field_provenance,
      data_quality: {
        trust_score: trustScore,
        stale_fields,
        stale_fields_count: staleFields.length,
        critical_stale: criticalStale,
        unresolved_conflict_fields: [...conflictFields],
        unresolved_conflicts_count: conflictFields.size,
        source_tiers: sourceTiers,
        freshness_status: criticalStale ? 'stale_critical' : (staleFields.length ? 'stale_noncritical' : 'fresh'),
        requires_review: criticalStale || conflictFields.size > 0
      },
      deal_score: scored.score,
      flags: scored.flags,
      internal_signals: [
        scored.flags.below_market ? 'Below-market signal detected from price-per-square-foot comparison.' : 'Standard market fit signal.',
        conflicts.length ? 'Source mismatch found; keep public note light until reviewed.' : 'No active source mismatch in current intake.',
        criticalStale ? 'Critical fields are stale (price/status); refresh source before public release.' : (staleFields.length ? `Non-critical stale fields: ${staleFields.join(', ')}` : 'Field freshness is within configured SLA windows.')
      ],
      public_summary: `${latest.city}, ${latest.province} · ${latest.beds} bed · ${latest.baths} bath · ${Number(latest.sqft || 0).toLocaleString()} sqft · ${scored.ppsf ? '$'+scored.ppsf+'/sqft' : 'sqft pending'}`,
      market_slug: `${slugify(latest.province)}-${slugify(latest.city)}`,
      source_inconsistency: conflicts.length ? { public_note: 'Some source fields were reconciled by Gary Doman & Ricki Kohli before release.' } : null,
      price_history: [{ at: latest.fetched_at, price: latest.list_price }]
    };
  }
  function reconcile(raw={}){
    const normalized = [];
    const runs = [];
    const sourceMap = [
      ['source_a', raw.source_a || []],
      ['source_b', raw.source_b || []],
      ['manual_uploads', raw.manual_uploads || []]
    ];
    sourceMap.forEach(([name, rows]) => {
      const profile = DEFAULT_SOURCE_PROFILES[name] || {};
      runs.push({ source:name, source_class:profile.source_class || 'unclassified', authority_tier:profile.authority_tier || 'C', records:rows.length, mode:'local_import', captured_at:new Date().toISOString(), status:'ok' });
      rows.forEach(r => normalized.push(normalizeSourceRecord(r, name)));
    });
    const groups = {};
    normalized.forEach(r => { (groups[r.listing_key] ||= []).push(r); });
    const canonical = [];
    const conflicts = [];
    Object.values(groups).forEach(group => {
      const merged = mergeGroup(group);
      canonical.push(merged);
      merged.source_conflicts.forEach(c => conflicts.push({
        listing_id: merged.id,
        address: merged.address,
        city: merged.city,
        province: merged.province,
        field: c.field,
        source_a_value: c.values[0]?.value ?? '',
        source_b_value: c.values[1]?.value ?? '',
        canonical_value: c.canonical_value,
        resolution: c.resolution,
        status: c.status
      }));
    });
    const releaseQueue = canonical.map(l => ({ id:l.id, address:l.address, city:l.city, province:l.province, verification_status:l.verification_status, first_seen_at:l.first_seen_at, status:'internal_only', freshness_status:l.data_quality?.freshness_status || 'unknown', trust_score:l.data_quality?.trust_score || 0 }));
    return {
      raw: { normalized_records: normalized.length },
      internal: {
        canonical_listings: canonical.sort((a,b)=>b.deal_score-a.deal_score),
        source_conflicts: conflicts,
        release_queue: releaseQueue,
        source_runs: { runs },
        leads: []
      }
    };
  }
  return { normalizeSourceRecord, reconcile, summarize(rawA=[], rawB=[]) { return { source_a_records: rawA.length, source_b_records: rawB.length, unique_ids_seen: new Set([...rawA,...rawB].map(r => r.listing_id || r.mls || r.address)).size, note:'Local resolver summary only. No remote data calls are made in this prototype.'}; } };
})();
