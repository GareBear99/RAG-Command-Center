/**
 * RAG Auto Lead Engine
 * Generates actionable leads from listing intelligence — zero external APIs.
 * 
 * Sources:
 * 1. Motivated sellers: high DOM + price drops → seller lead
 * 2. Below-market deals: high deal score → buyer opportunity lead
 * 3. Investor signals: fixer + below market → investor lead  
 * 4. New listing alerts: fresh listings in licensed areas → buyer match lead
 * 5. Price drop alerts: recent reductions → buyer notification lead
 * 6. Neighbourhood momentum: cluster analysis → area advisory lead
 */

const AutoLeads = (function(){
  const KEY = 'rag_auto_leads';
  const LAST_RUN = 'rag_autolead_lastrun';
  const STALE_DAYS = 7; /* leads older than 7 days with no interaction → stale */
  
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){ return []; } }
  function save(leads){ localStorage.setItem(KEY, JSON.stringify(leads.slice(0,500))); }
  
  /** Apply time-based freshness decay to all leads */
  function applyFreshness(leads){
    var now = Date.now();
    leads.forEach(function(l){
      var age = (now - new Date(l.created_at || 0).getTime()) / 86400000;
      if(age > STALE_DAYS && l.score !== 'stale'){
        l.original_score = l.original_score || l.score;
        l.score = 'stale';
        l.freshness = 'stale';
      } else {
        l.freshness = l.score === 'hot' ? 'hot' : (l.score === 'warm' ? 'warm' : 'cold');
      }
    });
    return leads;
  }
  
  function generate(listings){
    if (!listings || !listings.length) return [];
    const existing = load();
    const existingIds = new Set(existing.map(l=>l.source_listing_id));
    const newLeads = [];
    const m = loadLicensedMarkets();
    const licensedCities = m.cities || ['victoria'];
    
    listings.forEach(l => {
      const city = String(l.city||'').toLowerCase();
      const isLicensed = licensedCities.includes(city);
      const score = Number(l.deal_score||0);
      const dom = Number(l.days_on_market||0);
      const hasDrop = l.flags?.price_drop;
      const belowMarket = l.flags?.below_market;
      const isFixer = l.flags?.fixer;
      const isNew = l.flags?.new_listing;
      const price = Number(l.list_price||0);
      const beds = Number(l.beds||0);
      const hood = (l.description||'').match(/in ([^,]+),/)?.[1] || city;
      
      // Skip if already generated a lead for this listing
      if (existingIds.has(l.id)) return;
      
      // 1. MOTIVATED SELLER — DOM 45+ with price drop in licensed area
      if (isLicensed && dom >= 45 && hasDrop) {
        newLeads.push({
          id: 'auto_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
          type: 'seller_motivated',
          score: 'hot',
          title: 'Motivated Seller — ' + (l.address||''),
          detail: `${dom} days on market with price drop. ${hood} neighbourhood. Listed at $${price.toLocaleString()}.`,
          action: 'Contact listing agent — seller likely motivated to negotiate.',
          source_listing_id: l.id,
          address: l.address, city: l.city, province: l.province,
          price, beds, neighbourhood: hood,
          deal_score: score,
          agent: 'Amit Khatkar',
          created_at: new Date().toISOString(),
          auto_generated: true
        });
      }
      
      // 2. BELOW MARKET DEAL — high deal score in licensed area
      if (isLicensed && belowMarket && score >= 50) {
        newLeads.push({
          id: 'auto_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
          type: 'buyer_opportunity',
          score: score >= 65 ? 'hot' : 'warm',
          title: 'Below Market — ' + (l.address||''),
          detail: `Deal score ${score}%. Below area median $/sqft in ${hood}. ${beds} bed at $${price.toLocaleString()}.`,
          action: 'Match with active buyers looking in ' + hood + '.',
          source_listing_id: l.id,
          address: l.address, city: l.city, province: l.province,
          price, beds, neighbourhood: hood,
          deal_score: score,
          agent: 'Amit Khatkar',
          created_at: new Date().toISOString(),
          auto_generated: true
        });
      }
      
      // 3. INVESTOR SIGNAL — fixer + below market
      if (isLicensed && isFixer && (belowMarket || score >= 45)) {
        newLeads.push({
          id: 'auto_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
          type: 'investor_opportunity',
          score: 'warm',
          title: 'Investor Signal — ' + (l.address||''),
          detail: `Fixer in ${hood}. Built ${l.year_built||'unknown'}. Deal score ${score}%. $${price.toLocaleString()}.`,
          action: 'Flag for investor clients. Estimate renovation + ARV potential.',
          source_listing_id: l.id,
          address: l.address, city: l.city, province: l.province,
          price, beds, neighbourhood: hood,
          deal_score: score,
          agent: 'Amit Khatkar',
          created_at: new Date().toISOString(),
          auto_generated: true
        });
      }
      
      // 4. NEW LISTING in licensed area — fresh opportunity
      if (isLicensed && isNew && score >= 40) {
        newLeads.push({
          id: 'auto_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
          type: 'new_listing_alert',
          score: score >= 55 ? 'warm' : 'cold',
          title: 'New Listing — ' + (l.address||''),
          detail: `Just listed in ${hood}. ${beds} bed, $${price.toLocaleString()}. Deal score ${score}%.`,
          action: 'Review for buyer matches. First-mover advantage.',
          source_listing_id: l.id,
          address: l.address, city: l.city, province: l.province,
          price, beds, neighbourhood: hood,
          deal_score: score,
          agent: 'Amit Khatkar',
          created_at: new Date().toISOString(),
          auto_generated: true
        });
      }
      
      // 5. PRICE DROP ALERT — recent reduction
      if (isLicensed && hasDrop && dom < 45) {
        newLeads.push({
          id: 'auto_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
          type: 'price_drop_alert',
          score: 'warm',
          title: 'Price Reduced — ' + (l.address||''),
          detail: `Price dropped in ${hood}. Now $${price.toLocaleString()}. ${beds} bed. DOM ${dom}.`,
          action: 'Notify interested buyers in this price range and area.',
          source_listing_id: l.id,
          address: l.address, city: l.city, province: l.province,
          price, beds, neighbourhood: hood,
          deal_score: score,
          agent: 'Amit Khatkar',
          created_at: new Date().toISOString(),
          auto_generated: true
        });
      }
    });
    
    // Merge with existing, dedupe
    const all = [...newLeads, ...existing];
    // Apply stale decay before saving
    applyFreshness(all);
    save(all);
    localStorage.setItem(LAST_RUN, new Date().toISOString());
    return all;
  }
  
  /** Get lead counts by category including stale */
  function counts(leads){
    if(!leads) leads = load();
    applyFreshness(leads);
    return {
      total: leads.length,
      hot: leads.filter(function(l){ return l.score === 'hot'; }).length,
      warm: leads.filter(function(l){ return l.score === 'warm'; }).length,
      cold: leads.filter(function(l){ return l.score === 'cold'; }).length,
      stale: leads.filter(function(l){ return l.score === 'stale'; }).length
    };
  }
  
  // Neighbourhood momentum analysis
  function analyseNeighbourhoods(listings){
    const hoods = {};
    listings.forEach(l => {
      const hood = (l.description||'').match(/in ([^,]+),/)?.[1] || 'Unknown';
      if (!hoods[hood]) hoods[hood] = { name: hood, count: 0, drops: 0, belowMarket: 0, avgScore: 0, totalPrice: 0 };
      hoods[hood].count++;
      if (l.flags?.price_drop) hoods[hood].drops++;
      if (l.flags?.below_market) hoods[hood].belowMarket++;
      hoods[hood].avgScore += Number(l.deal_score||0);
      hoods[hood].totalPrice += Number(l.list_price||0);
    });
    Object.values(hoods).forEach(h => {
      h.avgScore = Math.round(h.avgScore / h.count);
      h.avgPrice = Math.round(h.totalPrice / h.count);
      h.dropRate = Math.round(h.drops / h.count * 100);
      h.momentum = h.dropRate > 20 ? 'cooling' : (h.belowMarket > h.count * 0.3 ? 'opportunity' : 'stable');
    });
    return Object.values(hoods).sort((a,b) => b.avgScore - a.avgScore);
  }
  
  return { load, save, generate, analyseNeighbourhoods, applyFreshness, counts, STALE_DAYS };
})();
