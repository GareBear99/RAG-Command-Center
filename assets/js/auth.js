window.GRRAuth = (function(){
  const POLICY_KEY = 'grr_access_policy_v1';
  const SESSION_KEY = 'grr_access_session_v1';
  const DEFAULT_POLICY = {
    enabled: false,
    session_minutes: 480,
    passcode_hash: '',
    updated_at: null
  };
  const ROLE_LEVEL = { viewer: 1, operator: 2, admin: 3 };
  const INTERNAL_PAGES = new Set([
    'command-center.html',
    'listings.html',
    'leads.html',
    'add.html',
    'settings.html',
    'import-source.html'
  ]);
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function pageName(){
    const raw = location.pathname.split('/').pop() || '';
    return raw.toLowerCase();
  }
  function roleLevel(role){ return ROLE_LEVEL[String(role || '').toLowerCase()] || 0; }
  function canAccess(role, requiredRole){ return roleLevel(role) >= roleLevel(requiredRole); }
  function requiredRoleForPage(name = pageName()){
    if (name === 'settings.html') return 'admin';
    if (INTERNAL_PAGES.has(name)) return 'operator';
    return 'viewer';
  }
  function isInternalPage(name = pageName()){ return INTERNAL_PAGES.has(name); }
  async function hashPasscode(passcode){
    const data = new TextEncoder().encode(`grr:${String(passcode || '')}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function loadPolicy(){
    try { return Object.assign({}, DEFAULT_POLICY, JSON.parse(localStorage.getItem(POLICY_KEY) || '{}')); }
    catch(e){ return clone(DEFAULT_POLICY); }
  }
  function savePolicy(policy){
    const next = Object.assign({}, DEFAULT_POLICY, policy || {}, { updated_at: new Date().toISOString() });
    localStorage.setItem(POLICY_KEY, JSON.stringify(next));
    return next;
  }
  function loadSessionRaw(){
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch(e){ return null; }
  }
  function clearSession(){ localStorage.removeItem(SESSION_KEY); }
  function getSession(){
    const session = loadSessionRaw();
    if (!session) return null;
    const expiry = new Date(session.expires_at || 0).getTime();
    if (!expiry || expiry <= Date.now()){
      clearSession();
      return null;
    }
    return session;
  }
  function setSession(payload){
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    return payload;
  }
  async function configurePolicy(opts = {}){
    const current = loadPolicy();
    const next = Object.assign({}, current, {
      enabled: typeof opts.enabled === 'boolean' ? opts.enabled : current.enabled,
      session_minutes: Number(opts.session_minutes || current.session_minutes || DEFAULT_POLICY.session_minutes) || DEFAULT_POLICY.session_minutes
    });
    const nextPass = String(opts.passcode || '');
    if (nextPass) next.passcode_hash = await hashPasscode(nextPass);
    if (next.enabled && !next.passcode_hash){
      return { ok:false, message:'Set a passcode before enabling access lock.' };
    }
    savePolicy(next);
    return { ok:true, policy:next };
  }
  async function beginSession(passcode, role = 'operator', name = ''){
    const policy = loadPolicy();
    if (!policy.enabled) return { ok:true, bypass:true, role:'admin' };
    if (!policy.passcode_hash || (await hashPasscode(passcode)) !== policy.passcode_hash){
      return { ok:false, message:'Invalid passcode.' };
    }
    const safeRole = ['viewer','operator','admin'].includes(String(role || '').toLowerCase()) ? String(role).toLowerCase() : 'operator';
    const expires = new Date(Date.now() + (Number(policy.session_minutes || DEFAULT_POLICY.session_minutes) * 60 * 1000)).toISOString();
    setSession({
      name: String(name || '').trim() || 'Operator',
      role: safeRole,
      created_at: new Date().toISOString(),
      expires_at: expires
    });
    return { ok:true, role:safeRole, expires_at:expires };
  }
  function renderLogin(requiredRole = 'operator'){
    const existing = document.getElementById('grr-auth-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'grr-auth-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,8,12,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:440px;width:100%;background:#131417;border:1px solid #2a2e38;border-radius:14px;padding:18px 18px 16px;color:#eaecf0;font-family:Inter,system-ui,sans-serif;';
    card.innerHTML = `
      <div style="font-size:20px;font-weight:700;letter-spacing:.01em">Internal Access Required</div>
      <div style="margin-top:6px;font-size:12px;color:#8e97a8;line-height:1.6">This page requires <b style="color:#d4a843">${requiredRole}</b> access.</div>
      <div style="display:grid;gap:10px;margin-top:14px">
        <input id="grr-auth-name" placeholder="Name" style="padding:11px 12px;border-radius:8px;border:1px solid #2a2e38;background:#191b20;color:#eaecf0">
        <select id="grr-auth-role" style="padding:11px 12px;border-radius:8px;border:1px solid #2a2e38;background:#191b20;color:#eaecf0"></select>
        <input id="grr-auth-passcode" type="password" placeholder="Access passcode" style="padding:11px 12px;border-radius:8px;border:1px solid #2a2e38;background:#191b20;color:#eaecf0">
      </div>
      <div id="grr-auth-error" style="min-height:18px;margin-top:8px;font-size:12px;color:#e9546f"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
        <button id="grr-auth-submit" style="padding:10px 14px;border-radius:8px;border:1px solid #d4a843;background:#d4a843;color:#111;font-weight:700;cursor:pointer">Unlock</button>
      </div>
    `;
    const roleSelect = card.querySelector('#grr-auth-role');
    ['viewer','operator','admin']
      .filter(r => canAccess(r, requiredRole))
      .forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        roleSelect.appendChild(opt);
      });
    roleSelect.value = requiredRole;
    const submit = card.querySelector('#grr-auth-submit');
    const passEl = card.querySelector('#grr-auth-passcode');
    const nameEl = card.querySelector('#grr-auth-name');
    const errorEl = card.querySelector('#grr-auth-error');
    async function runLogin(){
      const out = await beginSession(passEl.value, roleSelect.value, nameEl.value);
      if (!out.ok){
        errorEl.textContent = out.message || 'Access denied.';
        return;
      }
      overlay.remove();
      document.body.style.overflow = '';
      window.dispatchEvent(new CustomEvent('grr-auth-ready', { detail: out }));
      location.reload();
    }
    submit.addEventListener('click', runLogin);
    passEl.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') runLogin(); });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    setTimeout(()=>passEl.focus(), 20);
  }
  function ensureAccess(){
    if (!isInternalPage()) return true;
    const policy = loadPolicy();
    if (!policy.enabled) return true;
    const required = requiredRoleForPage();
    const session = getSession();
    if (session && canAccess(session.role, required)) return true;
    renderLogin(required);
    return false;
  }
  document.addEventListener('DOMContentLoaded', ensureAccess);
  return {
    loadPolicy,
    savePolicy,
    configurePolicy,
    beginSession,
    getSession,
    clearSession,
    ensureAccess,
    requiredRoleForPage
  };
})();
