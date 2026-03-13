
window.GRRCompiler = (function(){
  function slugify(v=''){ return String(v).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function unresolvedHighRiskConflictCount(listing){
    const highRisk = new Set(['list_price','status','address','city','province']);
    return (listing?.source_conflicts || []).filter(c => (c?.status || 'review') !== 'resolved' && highRisk.has(String(c?.field || '').toLowerCase())).length;
  }
  function releaseDecision(listing, canonicalCount=0, graceBypassUntil=1000){
    if (!listing) return { eligible:false, code:'missing_listing', reason:'Blocked: listing missing.' };
    if (listing.verification_status !== 'verified_internal') return { eligible:false, code:'verification_required', reason:'Blocked: verification required.' };
    if (listing?.data_quality?.critical_stale) return { eligible:false, code:'critical_stale', reason:'Blocked: critical fields stale (price/status).' };
    const highRiskConflicts = unresolvedHighRiskConflictCount(listing);
    if (highRiskConflicts > 0) return { eligible:false, code:'high_risk_conflict', reason:`Blocked: unresolved high-risk conflicts (${highRiskConflicts}).` };
    if (canonicalCount < graceBypassUntil) return { eligible:true, code:'grace_bypass', reason:'Eligible: bypass under listing threshold.' };
    const ageMs = Date.now() - new Date(listing.first_seen_at).getTime();
    if (ageMs >= 24*60*60*1000) return { eligible:true, code:'aged_24h', reason:'Eligible: grace window complete.' };
    return { eligible:false, code:'grace_hold', reason:'Blocked: within grace hold window.' };
  }
  function buildDirectoryIndex(releasedListings, graceBypassUntil=1000){
    const provinceNames = {
      BC:'British Columbia', AB:'Alberta', SK:'Saskatchewan', MB:'Manitoba', ON:'Ontario', QC:'Quebec', NB:'New Brunswick', NS:'Nova Scotia', PE:'Prince Edward Island', NL:'Newfoundland and Labrador', YT:'Yukon', NT:'Northwest Territories', NU:'Nunavut'
    };
    const byProvince = {};
    releasedListings.forEach(l => {
      const p = (l.province || '').toUpperCase();
      if (!p) return;
      const citySlug = slugify(l.city);
      const provinceSlug = slugify(provinceNames[p] || p);
      const bucket = byProvince[p] ||= { province_code:p, slug:provinceSlug, name:provinceNames[p] || p, listing_count:0, summary:'Verified public release coverage for this province or territory.', cities:{} };
      bucket.listing_count += 1;
      bucket.cities[citySlug] ||= { slug:citySlug, name:l.city, listing_count:0, top_deal_score:0 };
      bucket.cities[citySlug].listing_count += 1;
      bucket.cities[citySlug].top_deal_score = Math.max(bucket.cities[citySlug].top_deal_score, l.deal_score || 0);
    });
    const provinces = Object.values(byProvince).map(p => ({ ...p, cities:Object.values(p.cities).sort((a,b)=>b.listing_count-a.listing_count) })).sort((a,b)=>b.listing_count-a.listing_count);
    return { generated_at:new Date().toISOString(), grace_bypass_until_listing_count:graceBypassUntil, provinces };
  }
  function buildReleaseManifest(canonical, released, graceBypassUntil){
    const provinceSet = new Set();
    const cityKeys = new Set();
    released.forEach(r => {
      const p = String(r.province||'').trim().toUpperCase();
      const c = String(r.city||'').trim().toLowerCase();
      if (p) provinceSet.add(p);
      if (p && c) cityKeys.add(`${p}::${c}`);
    });
    return {
      generated_at: new Date().toISOString(),
      compiler_version: 'rg-browser-v1',
      counts: {
        canonical_listings: canonical.length,
        released_listings: released.length
      },
      coverage: {
        national_province_target: 13,
        released_public: {
          province_count: provinceSet.size,
          city_count: cityKeys.size,
          is_national: provinceSet.size >= 13
        }
      },
      manual_mode: { effective_seed_mode: 'off' }
    };
  }
  function compilePublic(canonical=[], existingReleased=[], graceBypassUntil=1000){
    const count = canonical.length;
    const existingMap = new Map((existingReleased||[]).map(l => [l.id, l]));
    const released = canonical.filter(l => {
      if (existingMap.has(l.id)) return true;
      return releaseDecision(l, count, graceBypassUntil).eligible;
    }).map(l => {
      const decision = releaseDecision(l, count, graceBypassUntil);
      return {
        ...l,
        status:'public_live',
        public_eligible:true,
        release_reason: decision.code,
        release_reason_detail: decision.reason,
        public_released_at: existingMap.get(l.id)?.public_released_at || new Date().toISOString(),
        instant_update_mode:true
      };
    });
    return {
      released_listings: released.sort((a,b)=>b.deal_score-a.deal_score),
      directory_index: buildDirectoryIndex(released, graceBypassUntil),
      release_manifest: buildReleaseManifest(canonical, released, graceBypassUntil)
    };
  }
  return { buildDirectoryIndex, compilePublic, explain() { return { internal_to_public:'canonical internal listings -> release rules -> released public listings', note:'This browser build can now compile local imports into a releasable public dataset without a server.' }; } };
})();
