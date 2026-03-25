/**
 * EVE — RAG Command Center AI Assistant
 * Hooked into listings, leads, pipeline, signals, commissions, and settings.
 * Client-side intelligence engine with pattern-matched responses.
 */
const EVE = (function(){
  const CHAT_KEY = 'rag_eve_history';

  function loadChat(){ try{ return JSON.parse(localStorage.getItem(CHAT_KEY)||'[]'); }catch{ return []; } }
  function saveChat(msgs){ localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-100))); }

  /* ═══════════ DATA SNAPSHOT ═══════════ */
  async function getSnapshot(){
    const data = await GRR.loadData();
    const state = GRR.loadState();
    const listings = data.internal.canonicalListings || [];
    const publicListings = GRR.getPublicListings(data) || [];
    const leads = (data.internal.leads || []).concat((state.inquiries||[]).map(i=>({name:i.name,email:i.email,phone:i.phone||'',score_band:i.score_band||'warm',intent:i.intent||'inquiry',market:i.market||'',budget:i.budget||'',notes:i.notes||'',created_at:i.created_at||''})));
    const contacts = JSON.parse(localStorage.getItem('rag_crm_contacts')||'[]');
    const pipeDeals = JSON.parse(localStorage.getItem('rag_pipeline_deals')||'[]');
    const commDeals = JSON.parse(localStorage.getItem('rag_commission_deals')||'[]');
    const signals = JSON.parse(localStorage.getItem('rag_signal_history')||'[]');
    const markets = loadLicensedMarkets();
    const conflicts = data.internal.sourceConflicts || [];

    const hotLeads = leads.filter(l=>(l.score_band||'warm')==='hot');
    const warmLeads = leads.filter(l=>(l.score_band||'warm')==='warm');
    const topDeal = listings.length ? listings.reduce((best,l)=>Number(l.deal_score||0)>Number(best.deal_score||0)?l:best, listings[0]) : null;
    const priceDrops = listings.filter(l=>l.flags?.price_drop);
    const belowMarket = listings.filter(l=>l.flags?.below_market);
    const bcListings = listings.filter(l=>String(l.province||'').toUpperCase()==='BC');
    const vicListings = listings.filter(l=>String(l.city||'').toLowerCase()==='victoria');
    const vanListings = listings.filter(l=>String(l.city||'').toLowerCase()==='vancouver');
    const activePipe = pipeDeals.filter(d=>d.stage!=='closed');
    const closedPipe = pipeDeals.filter(d=>d.stage==='closed');
    const totalGross = commDeals.reduce((s,d)=>s+(d.gross||0),0);
    const hotSignals = signals.filter(s=>s.score>=70);

    return {
      listings, publicListings, leads, contacts, pipeDeals, commDeals, signals, markets, conflicts,
      hotLeads, warmLeads, topDeal, priceDrops, belowMarket, bcListings, vicListings, vanListings,
      activePipe, closedPipe, totalGross, hotSignals,
      summary: {
        totalListings: listings.length,
        publicCount: publicListings.length,
        totalLeads: leads.length,
        hotCount: hotLeads.length,
        warmCount: warmLeads.length,
        contactCount: contacts.length,
        pipelineActive: activePipe.length,
        pipelineClosed: closedPipe.length,
        pipelineValue: activePipe.reduce((s,d)=>s+(d.value||0),0),
        commissionDeals: commDeals.length,
        totalGross,
        signalsProcessed: signals.length,
        hotSignals: hotSignals.length,
        conflictCount: conflicts.length,
        topDealScore: topDeal ? Number(topDeal.deal_score||0) : 0,
        priceDropCount: priceDrops.length,
        belowMarketCount: belowMarket.length,
        licensedProvince: markets.province,
        licensedCities: markets.cities
      }
    };
  }

  /* ═══════════ RESPONSE ENGINE ═══════════ */
  async function respond(input){
    const q = input.toLowerCase().trim();
    const snap = await getSnapshot();
    const s = snap.summary;

    // Greetings
    if (q.match(/^(hi|hello|hey|sup|yo|what'?s up)/)) {
      return `Hey. I'm EVE — your RAG Command Center assistant. You've got ${s.totalListings} listings, ${s.totalLeads} leads, and ${s.pipelineActive} active deals in the pipeline. ${s.hotCount ? `${s.hotCount} hot leads need attention.` : 'No hot leads right now.'} What do you want to focus on?`;
    }

    // What should I do / what's next / priorities
    if (q.match(/what.*(should|do|next|priority|focus|start|first|action)/)) {
      const actions = [];
      if (s.hotCount) actions.push(`Call your ${s.hotCount} hot lead${s.hotCount>1?'s':''} first — they're time-sensitive.`);
      if (s.priceDropCount) actions.push(`${s.priceDropCount} listings just dropped in price. Check the Deals page for motivated sellers.`);
      if (s.belowMarketCount) actions.push(`${s.belowMarketCount} listings are below market value — flag them for your buyers.`);
      if (s.conflictCount) actions.push(`${s.conflictCount} source conflicts need resolution in the pipeline.`);
      if (s.pipelineActive) actions.push(`${s.pipelineActive} active deals in your pipeline worth $${s.pipelineValue.toLocaleString()}.`);
      if (!s.totalLeads) actions.push(`No leads yet. Go to Signals and paste Facebook group posts to start building your lead queue.`);
      if (!actions.length) actions.push('Platform is clean. Import new listings via Settings, or paste FB group posts in Signals to generate leads.');
      return actions.join('\n\n');
    }

    // Leads
    if (q.match(/lead|who.*call|hot|warm|cold/)) {
      if (!s.totalLeads) return 'No leads in the system yet. Use the Signals page to paste Facebook group posts — I\'ll score them and create leads automatically.';
      let resp = `You have ${s.totalLeads} leads: ${s.hotCount} hot 🔥, ${s.warmCount} warm 🌡, ${s.totalLeads-s.hotCount-s.warmCount} cold.`;
      if (snap.hotLeads.length) {
        resp += '\n\nHot leads to call now:';
        snap.hotLeads.slice(0,5).forEach(l => {
          resp += `\n• ${l.name||'Unnamed'} — ${l.market||l.intent||'no details'} ${l.budget ? '· $'+Number(l.budget).toLocaleString() : ''}`;
        });
      }
      return resp;
    }

    // Deals / listings / top deals
    if (q.match(/deal|listing|best|top|score|property|cheap|below market|price drop/)) {
      if (!s.totalListings) return 'No listings loaded yet. Go to Settings → Import Source Files to load listing data, then Reconcile + Compile.';
      let resp = `${s.totalListings} total listings. ${s.publicCount} public. Top deal score: ${s.topDealScore}%.`;
      if (snap.topDeal) resp += `\n\nBest deal: ${snap.topDeal.address||''}, ${snap.topDeal.city||''} — $${Number(snap.topDeal.list_price||0).toLocaleString()} · ${snap.topDeal.deal_score}% score.`;
      if (s.priceDropCount) resp += `\n\n${s.priceDropCount} price drops detected. Check the Deals tab.`;
      if (s.belowMarketCount) resp += `\n${s.belowMarketCount} below-market listings flagged.`;
      return resp;
    }

    // Pipeline
    if (q.match(/pipeline|kanban|stage|deal.*stage|active.*deal|close/)) {
      if (!snap.pipeDeals.length) return 'Pipeline is empty. Leads auto-import as deals when you add them. Go to Pipeline to drag deals between stages.';
      const stages = {};
      snap.pipeDeals.forEach(d => { stages[d.stage] = (stages[d.stage]||0)+1; });
      let resp = `Pipeline: ${s.pipelineActive} active deals worth $${s.pipelineValue.toLocaleString()}.`;
      Object.entries(stages).forEach(([stage,count]) => {
        resp += `\n• ${stage.replace(/_/g,' ')}: ${count}`;
      });
      if (s.pipelineClosed) resp += `\n\n${s.pipelineClosed} deals closed.`;
      return resp;
    }

    // Commission
    if (q.match(/commission|revenue|money|earning|payout|split|tier/)) {
      if (!s.commissionDeals) return 'No commission data yet. Deals auto-import to commissions when you drag them to Closed in the Pipeline.';
      const rate = s.commissionDeals <= 5 ? '20%' : (s.commissionDeals <= 10 ? '25%' : '30%');
      let platformRev = 0;
      snap.commDeals.forEach((d,i) => { const r = i<5?0.20:(i<10?0.25:0.30); platformRev += (d.gross||0)*r; });
      return `${s.commissionDeals} deals closed. Gross commission: $${s.totalGross.toLocaleString()}. Platform revenue: $${Math.round(platformRev).toLocaleString()}.\nCurrent tier: ${rate} (per §7).\nGary: 51% · Ricki + Amit: 49% (per §8).`;
    }

    // Signals / Facebook
    if (q.match(/signal|facebook|fb|paste|group|social/)) {
      if (!s.signalsProcessed) return 'No signals processed yet. Go to the Signals page, paste a Facebook group post, and I\'ll score the intent. 70+ = hot lead. Victoria posts auto-route to Amit, Vancouver to Ricki.';
      return `${s.signalsProcessed} signals processed. ${s.hotSignals} scored as hot leads. Average intent score across all signals. Go to Signals to paste more FB posts.`;
    }

    // Victoria / Vancouver / market
    if (q.match(/victoria|vancouver|market|licensed|area|bc/)) {
      const m = snap.markets;
      let resp = `Licensed markets: ${m.province} — ${m.cities.join(', ')}. These get priority sorting on public pages and auto-routing in the pipeline.`;
      if (snap.vicListings.length) resp += `\nVictoria: ${snap.vicListings.length} listings.`;
      if (snap.vanListings.length) resp += `\nVancouver: ${snap.vanListings.length} listings.`;
      if (snap.bcListings.length) resp += `\nTotal BC: ${snap.bcListings.length} listings.`;
      resp += `\n\nChange licensed areas in Settings → Licensed Markets.`;
      return resp;
    }

    // Contacts / CRM
    if (q.match(/contact|crm|client|database/)) {
      if (!s.contactCount) return 'CRM is empty. Contacts auto-import from pipeline leads. You can also add manually on the Contacts page, or create leads from the Signals page.';
      const buyers = snap.contacts.filter(c=>c.type==='buyer').length;
      const sellers = snap.contacts.filter(c=>c.type==='seller').length;
      return `${s.contactCount} contacts in CRM. ${buyers} buyers, ${sellers} sellers. ${snap.contacts.filter(c=>c.score==='hot').length} hot. Go to Contacts to manage.`;
    }

    // Settings / how to
    if (q.match(/setting|config|import|source|reconcile|compile|setup|how/)) {
      return 'Settings page handles:\n• Source connectors (API endpoints for listing data)\n• Import Source Files (load local JSON packs)\n• Reconcile + Compile (merge sources → canonical → public)\n• Licensed Markets (set your priority cities)\n• Access Control (passcode protection)\n\nQuick start: Import → Reconcile → Check Dashboard.';
    }

    // Help / what can you do
    if (q.match(/help|what.*can.*you|command|feature|page/)) {
      return 'I can tell you about:\n• **Leads** — who to call, hot/warm/cold status\n• **Deals** — top scores, price drops, below-market\n• **Pipeline** — active deals, stages, values\n• **Commissions** — tiers, payouts, splits\n• **Signals** — FB group lead intake stats\n• **Markets** — Victoria/Vancouver coverage\n• **Contacts** — CRM status\n• **Settings** — how to import and configure\n• **What to do next** — prioritized action list\n\nJust ask naturally.';
    }

    // Amit / Ricki / Gary / team
    if (q.match(/amit|ricki|gary|team|who|agent/)) {
      return 'The RAG team:\n• **Ricki Kohli** — Operator Partner. Vancouver/Surrey focus.\n• **Amit Khatkar** — Operator Partner. Victoria/Saanich/Langford focus. Uses FB groups for lead gen.\n• **Gary Doman** — Platform Founder (51% ownership). Built the deal scoring engine, data pipeline, and this entire platform.\n\nLead routing: Victoria area signals → Amit. Vancouver area → Ricki.';
    }

    // Fallback
    return `I'm not sure what you're asking. Try:\n• "What should I do next?"\n• "Show me my leads"\n• "Top deals"\n• "Pipeline status"\n• "Commission summary"\n• "How do signals work?"\n• "Victoria market stats"`;
  }

  return { loadChat, saveChat, respond, getSnapshot };
})();
