window.GPSFallbackMap = (function(){
  const TILE = 256;
  const DEFAULT_ZOOM = 15.2;
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 19.5;
  const FALLBACK_CENTER = { lat: 56.1304, lng: -106.3468 };
  const CITY_CENTERS = {
    'vancouver|BC': { lat: 49.2827, lng: -123.1207 },
    'victoria|BC': { lat: 48.4284, lng: -123.3656 },
    'saanich|BC': { lat: 48.4844, lng: -123.3818 },
    'langford|BC': { lat: 48.4501, lng: -123.4983 },
    'esquimalt|BC': { lat: 48.4316, lng: -123.4317 },
    'nanaimo|BC': { lat: 49.1659, lng: -123.9401 },
    'courtenay|BC': { lat: 49.6880, lng: -124.9936 },
    'kelowna|BC': { lat: 49.8880, lng: -119.4960 },
    'calgary|AB': { lat: 51.0447, lng: -114.0719 },
    'edmonton|AB': { lat: 53.5461, lng: -113.4938 },
    'toronto|ON': { lat: 43.6532, lng: -79.3832 },
    'ottawa|ON': { lat: 45.4215, lng: -75.6972 },
    'montreal|QC': { lat: 45.5017, lng: -73.5673 },
    'winnipeg|MB': { lat: 49.8951, lng: -97.1384 },
    'halifax|NS': { lat: 44.6488, lng: -63.5752 },
    'moncton|NB': { lat: 46.0878, lng: -64.7782 },
    "st. john's|NL": { lat: 47.5615, lng: -52.7126 },
    'charlottetown|PE': { lat: 46.2382, lng: -63.1311 },
    'whitehorse|YT': { lat: 60.7212, lng: -135.0568 },
    'yellowknife|NT': { lat: 62.4540, lng: -114.3718 },
    'iqaluit|NU': { lat: 63.7467, lng: -68.5170 }
  };

  /* ── Tile providers ─────────────────────────────────────── */
  const TILE_PROVIDERS = {
    dark:      { label: 'Dark',      url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',      attr: '© CartoDB © OSM' },
    street:    { label: 'Street',    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',               attr: '© OpenStreetMap' },
    satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
    topo:      { label: 'Topo',      url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png', attr: '© CartoDB © OSM' }
  };
  const DEFAULT_PROVIDER = 'dark';

  function _safeAttr(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _safeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
  function isValidLatLng(lat, lng){ return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
  function hashCode(text=''){
    let h = 0;
    const s = String(text || '');
    for(let i=0;i<s.length;i++){ h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function formatCityKey(city='', province=''){
    return `${String(city || '').trim().toLowerCase()}|${String(province || '').trim().toUpperCase()}`;
  }
  function jitter(base, seedText=''){
    const h = hashCode(seedText);
    const latJ = ((h % 2001) / 100000) - 0.01;
    const lngJ = (((Math.floor(h / 2001)) % 2001) / 100000) - 0.01;
    return { lat: base.lat + latJ, lng: base.lng + lngJ };
  }
  function readLatLng(listing){
    const lat = toNum(listing?.lat ?? listing?.field_provenance?.lat?.value);
    const lng = toNum(listing?.lng ?? listing?.field_provenance?.lng?.value);
    if (isValidLatLng(lat, lng)) return { lat, lng, precision: 'exact' };
    const key = formatCityKey(listing?.city, listing?.province);
    const base = CITY_CENTERS[key] || FALLBACK_CENTER;
    const seed = `${listing?.address || ''}|${listing?.city || ''}|${listing?.province || ''}`;
    const approx = jitter(base, seed);
    return { lat: approx.lat, lng: approx.lng, precision: CITY_CENTERS[key] ? 'approx_city' : 'approx_region' };
  }
  function mercator(lat, lng, z){
    const scale = TILE * Math.pow(2, z);
    const x = (lng + 180) / 360 * scale;
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    return { x, y };
  }
  function unmercator(x, y, z){
    const scale = TILE * Math.pow(2, z);
    const lng = x / scale * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / scale;
    const lat = 180 / Math.PI * Math.atan(Math.sinh(n));
    return { lat, lng };
  }

  /* ── Static thumbnail URL (for listing card images) ───── */
  function staticThumbnailUrl(lat, lng, zoom, provider){
    const z = Math.max(0, Math.min(19, Math.floor(zoom || 15)));
    const prov = TILE_PROVIDERS[provider] || TILE_PROVIDERS[DEFAULT_PROVIDER];
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return prov.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  /** Return HTML for a listing card thumbnail.
   *  Priority: real images > map tile from coordinates > styled placeholder. */
  function listingThumbnailHtml(listing, opts={}){
    const images = listing?.images || [];
    if (images.length && typeof images[0] === 'string' && images[0].startsWith('http')){
      return `<img src="${_safeAttr(images[0])}" alt="Property photo" loading="lazy" draggable="false" style="width:100%;height:100%;object-fit:cover">`;
    }
    const point = readLatLng(listing || {});
    if (point.precision === 'exact' || point.precision === 'approx_city'){
      const zoom = opts.zoom || (point.precision === 'exact' ? 16 : 14);
      const provider = opts.provider || 'dark';
      const url = staticThumbnailUrl(point.lat, point.lng, zoom, provider);
      const pin = point.precision === 'exact' ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:12px;height:12px;border-radius:50%;background:#67f6ff;border:2px solid #07202a;box-shadow:0 0 12px rgba(103,246,255,.55)"></div>' : '';
      const precLabel = point.precision === 'exact' ? 'GPS exact' : 'GPS approx';
      return `<img src="${url}" alt="Map view" loading="lazy" draggable="false" style="width:100%;height:100%;object-fit:cover">${pin}<div class="gps-thumb-tag">${precLabel}</div>`;
    }
    /* No usable coordinates — styled placeholder */
    const ptype = String(listing?.property_type || '').trim();
    const icon = ptype.includes('condo') || ptype.includes('strata') ? '🏢' : (ptype.includes('town') ? '🏘' : '🏠');
    const loc = [listing?.city, listing?.province].filter(Boolean).join(', ');
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:6px"><span style="font-size:42px;line-height:1">${icon}</span><span style="font-family:var(--mono,monospace);font-size:9px;color:#8e97a8;text-transform:uppercase;letter-spacing:.12em">${_safeHtml(loc) || 'Location n/a'}</span></div>`;
  }

  /* ── Helper: build control button ─────────────────────── */
  function _mkBtn(text, title){
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title || '';
    b.style.cssText = 'width:30px;height:30px;border:1px solid #1d4256;border-radius:6px;background:rgba(7,16,21,.82);color:#8fb5c9;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--mono,monospace);transition:background .12s,color .12s;padding:0;line-height:1';
    b.addEventListener('mouseenter', ()=>{ b.style.background = 'rgba(103,246,255,.18)'; b.style.color = '#67f6ff'; });
    b.addEventListener('mouseleave', ()=>{ b.style.background = 'rgba(7,16,21,.82)'; b.style.color = '#8fb5c9'; });
    return b;
  }

  /* ── Full interactive map ────────────────────────────── */
  function create(container, opts={}){
    const root = typeof container === 'string' ? document.getElementById(container) : container;
    if (!root) return null;
    if (typeof root.__gpsMapDestroy === 'function') root.__gpsMapDestroy();

    root.innerHTML = '';
    root.style.position = 'relative';
    root.style.overflow = 'hidden';
    root.style.background = 'radial-gradient(circle at 30% 20%, #102030 0%, #071118 42%, #04090d 100%)';

    const tiles = document.createElement('div');
    tiles.style.cssText = 'position:absolute;inset:0;z-index:0;overflow:hidden';
    root.appendChild(tiles);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none';
    root.appendChild(svg);

    /* Overlay canvas for radius circle */
    const overlayCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlayCanvas.setAttribute('viewBox', '0 0 1000 1000');
    overlayCanvas.setAttribute('preserveAspectRatio', 'none');
    overlayCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none';
    root.appendChild(overlayCanvas);

    /* ── Precision badge ─── */
    const precisionTag = document.createElement('div');
    precisionTag.style.cssText = 'position:absolute;left:10px;bottom:10px;z-index:4;padding:4px 8px;font-family:var(--mono,ui-monospace,monospace);font-size:10px;color:#8fb5c9;border:1px solid #1d4256;border-radius:8px;background:rgba(7,16,21,.82)';
    root.appendChild(precisionTag);

    /* ── Zoom controls (+/-) ─── */
    const zoomBox = document.createElement('div');
    zoomBox.style.cssText = 'position:absolute;top:10px;right:10px;z-index:5;display:flex;flex-direction:column;gap:4px';
    const zoomIn = _mkBtn('+', 'Zoom in');
    const zoomOut = _mkBtn('−', 'Zoom out');
    zoomBox.appendChild(zoomIn); zoomBox.appendChild(zoomOut);
    root.appendChild(zoomBox);

    /* ── Layer toggle buttons ─── */
    const layerBox = document.createElement('div');
    layerBox.style.cssText = 'position:absolute;top:10px;left:10px;z-index:5;display:flex;gap:4px;flex-wrap:wrap';
    root.appendChild(layerBox);

    /* ── Overlay toggle buttons ─── */
    const overlayBox = document.createElement('div');
    overlayBox.style.cssText = 'position:absolute;bottom:10px;right:10px;z-index:5;display:flex;gap:4px';
    root.appendChild(overlayBox);

    const center = opts.center || FALLBACK_CENTER;
    let currentProvider = opts.provider || DEFAULT_PROVIDER;
    const view = { cx: center.lng, cy: center.lat, zoom: clamp(Number(opts.zoom || DEFAULT_ZOOM), MIN_ZOOM, MAX_ZOOM) };
    const listeners = [];
    let marker = null;
    let overlayState = { marker: true, radius: false };
    let dragging = false;
    let last = { x: 0, y: 0 };

    function size(){
      const r = root.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }
    function project(lat, lng){
      const { w, h } = size();
      const zi = Math.max(0, Math.floor(view.zoom));
      const frac = view.zoom - zi;
      const scale = Math.pow(2, frac);
      const c = mercator(view.cy, view.cx, zi);
      const p = mercator(lat, lng, zi);
      return { x: w / 2 + (p.x - c.x) * scale, y: h / 2 + (p.y - c.y) * scale };
    }
    function unproject(x, y){
      const { w, h } = size();
      const zi = Math.max(0, Math.floor(view.zoom));
      const frac = view.zoom - zi;
      const scale = Math.pow(2, frac);
      const c = mercator(view.cy, view.cx, zi);
      return unmercator(c.x + (x - w / 2) / scale, c.y + (y - h / 2) / scale, zi);
    }
    function tileUrl(z, x, y){
      const prov = TILE_PROVIDERS[currentProvider] || TILE_PROVIDERS[DEFAULT_PROVIDER];
      return prov.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }

    function drawTiles(){
      tiles.innerHTML = '';
      const { w, h } = size();
      const zi = Math.max(0, Math.min(19, Math.floor(view.zoom)));
      const frac = view.zoom - zi;
      const scale = Math.pow(2, frac);
      const c = mercator(view.cy, view.cx, zi);
      const topLeft = { x: c.x - w / (2 * scale), y: c.y - h / (2 * scale) };
      const bottomRight = { x: c.x + w / (2 * scale), y: c.y + h / (2 * scale) };
      const minTileX = Math.floor(topLeft.x / TILE), maxTileX = Math.floor(bottomRight.x / TILE);
      const minTileY = Math.floor(topLeft.y / TILE), maxTileY = Math.floor(bottomRight.y / TILE);
      const maxIndex = Math.pow(2, zi);

      for(let tx=minTileX; tx<=maxTileX; tx++){
        for(let ty=minTileY; ty<=maxTileY; ty++){
          if (ty < 0 || ty >= maxIndex) continue;
          const wrapX = ((tx % maxIndex) + maxIndex) % maxIndex;
          const img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.referrerPolicy = 'no-referrer';
          img.decoding = 'async';
          img.src = tileUrl(zi, wrapX, ty);
          img.style.cssText = `position:absolute;left:${((tx * TILE - topLeft.x) * scale).toFixed(2)}px;top:${((ty * TILE - topLeft.y) * scale).toFixed(2)}px;width:${(TILE * scale).toFixed(2)}px;height:${(TILE * scale).toFixed(2)}px;max-width:none;max-height:none;pointer-events:none`;
          img.onerror = () => { img.style.display = 'none'; };
          tiles.appendChild(img);
        }
      }
    }

    function drawMarker(){
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (!marker || !overlayState.marker) return;
      const p = project(marker.lat, marker.lng);
      const ns = 'http://www.w3.org/2000/svg';

      /* Outer pulse ring */
      const pulse = document.createElementNS(ns, 'circle');
      pulse.setAttribute('cx', p.x);
      pulse.setAttribute('cy', p.y);
      pulse.setAttribute('r', '18');
      pulse.setAttribute('fill', 'rgba(103,246,255,.18)');
      pulse.setAttribute('stroke', 'rgba(103,246,255,.55)');
      pulse.setAttribute('stroke-width', '1.5');
      svg.appendChild(pulse);

      /* Inner dot */
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      dot.setAttribute('r', '6');
      dot.setAttribute('fill', '#67f6ff');
      dot.setAttribute('stroke', '#07202a');
      dot.setAttribute('stroke-width', '2');
      svg.appendChild(dot);

      if (marker.label){
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', p.x);
        label.setAttribute('y', p.y - 14);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '11');
        label.setAttribute('fill', '#d6f2ff');
        label.setAttribute('stroke', 'rgba(7,16,21,.85)');
        label.setAttribute('stroke-width', '3');
        label.setAttribute('paint-order', 'stroke');
        label.textContent = marker.label;
        svg.appendChild(label);
      }
    }

    function drawOverlays(){
      while (overlayCanvas.firstChild) overlayCanvas.removeChild(overlayCanvas.firstChild);
      if (!marker || !overlayState.radius) return;
      const ns = 'http://www.w3.org/2000/svg';
      const p = project(marker.lat, marker.lng);
      /* 200m radius circle — approximate pixels at current zoom */
      const metersPerPixel = 156543.03392 * Math.cos(marker.lat * Math.PI / 180) / Math.pow(2, view.zoom);
      const radiusPixels = Math.max(20, 200 / metersPerPixel);

      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', p.x);
      ring.setAttribute('cy', p.y);
      ring.setAttribute('r', String(radiusPixels));
      ring.setAttribute('fill', 'rgba(103,246,255,.06)');
      ring.setAttribute('stroke', 'rgba(103,246,255,.35)');
      ring.setAttribute('stroke-width', '1.5');
      ring.setAttribute('stroke-dasharray', '6 4');
      overlayCanvas.appendChild(ring);

      /* label */
      const txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', p.x);
      txt.setAttribute('y', p.y + radiusPixels + 14);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '9');
      txt.setAttribute('fill', 'rgba(103,246,255,.6)');
      txt.setAttribute('font-family', 'var(--mono,monospace)');
      txt.textContent = '~200 m radius';
      overlayCanvas.appendChild(txt);
    }

    function redraw(){ drawTiles(); drawMarker(); drawOverlays(); }

    /* ── Layer switcher UI ─── */
    function buildLayerButtons(){
      layerBox.innerHTML = '';
      Object.keys(TILE_PROVIDERS).forEach(key => {
        const btn = _mkBtn(TILE_PROVIDERS[key].label.charAt(0), TILE_PROVIDERS[key].label);
        btn.style.fontSize = '10px';
        btn.style.width = 'auto';
        btn.style.padding = '4px 8px';
        if (key === currentProvider){ btn.style.background = 'rgba(103,246,255,.22)'; btn.style.color = '#67f6ff'; btn.style.borderColor = 'rgba(103,246,255,.4)'; }
        btn.addEventListener('click', (e) => { e.stopPropagation(); currentProvider = key; buildLayerButtons(); redraw(); });
        layerBox.appendChild(btn);
      });
    }
    buildLayerButtons();

    /* ── Overlay toggle UI ─── */
    function buildOverlayButtons(){
      overlayBox.innerHTML = '';
      const items = [
        { key: 'marker', label: '📍', title: 'Property marker' },
        { key: 'radius', label: '◎', title: 'Area radius (200m)' }
      ];
      items.forEach(item => {
        const btn = _mkBtn(item.label, item.title);
        btn.style.fontSize = '12px';
        if (overlayState[item.key]){ btn.style.background = 'rgba(103,246,255,.22)'; btn.style.color = '#67f6ff'; btn.style.borderColor = 'rgba(103,246,255,.4)'; }
        btn.addEventListener('click', (e) => { e.stopPropagation(); overlayState[item.key] = !overlayState[item.key]; buildOverlayButtons(); redraw(); });
        overlayBox.appendChild(btn);
      });
    }
    buildOverlayButtons();

    function setMarker(point, opts={}){
      marker = { lat: point.lat, lng: point.lng, label: opts.label || '' };
      precisionTag.textContent = opts.precision ? `GPS ${opts.precision}` : 'GPS mapped';
      redraw();
    }
    function setCenter(point, zoom){
      view.cx = point.lng;
      view.cy = point.lat;
      if (typeof zoom === 'number') view.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      redraw();
    }
    function setProvider(key){
      if (TILE_PROVIDERS[key]){ currentProvider = key; buildLayerButtons(); redraw(); }
    }

    /* ── Mouse interactions ─── */
    const onMouseDown = (e) => { if (e.target.tagName === 'BUTTON') return; dragging = true; last = { x: e.clientX, y: e.clientY }; root.style.cursor = 'grabbing'; };
    const onMouseUp = () => { dragging = false; root.style.cursor = 'grab'; };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const rect = root.getBoundingClientRect();
      const a = unproject(last.x - rect.left, last.y - rect.top);
      const b = unproject(e.clientX - rect.left, e.clientY - rect.top);
      view.cx += a.lng - b.lng;
      view.cy += a.lat - b.lat;
      last = { x: e.clientX, y: e.clientY };
      redraw();
    };
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 0.84;
      view.zoom = clamp(view.zoom + Math.log2(factor), MIN_ZOOM, MAX_ZOOM);
      redraw();
    };
    const onResize = () => redraw();

    /* ── Touch interactions (pinch-to-zoom + drag) ─── */
    let touches = [];
    let pinchStartDist = 0;
    let pinchStartZoom = 0;
    const onTouchStart = (e) => {
      touches = [...e.touches];
      if (touches.length === 1){ dragging = true; last = { x: touches[0].clientX, y: touches[0].clientY }; }
      if (touches.length === 2){
        dragging = false;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        pinchStartZoom = view.zoom;
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragging){
        const t = e.touches[0];
        const rect = root.getBoundingClientRect();
        const a = unproject(last.x - rect.left, last.y - rect.top);
        const b = unproject(t.clientX - rect.left, t.clientY - rect.top);
        view.cx += a.lng - b.lng;
        view.cy += a.lat - b.lat;
        last = { x: t.clientX, y: t.clientY };
        redraw();
      }
      if (e.touches.length === 2){
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (pinchStartDist > 0){
          const scale = dist / pinchStartDist;
          view.zoom = clamp(pinchStartZoom + Math.log2(scale), MIN_ZOOM, MAX_ZOOM);
          redraw();
        }
      }
    };
    const onTouchEnd = () => { dragging = false; touches = []; pinchStartDist = 0; };

    /* ── Zoom button handlers ─── */
    zoomIn.addEventListener('click', (e) => { e.stopPropagation(); view.zoom = clamp(view.zoom + 0.5, MIN_ZOOM, MAX_ZOOM); redraw(); });
    zoomOut.addEventListener('click', (e) => { e.stopPropagation(); view.zoom = clamp(view.zoom - 0.5, MIN_ZOOM, MAX_ZOOM); redraw(); });

    root.style.cursor = 'grab';
    root.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouchStart, { passive: false });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    window.addEventListener('resize', onResize);
    listeners.push(
      () => root.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => root.removeEventListener('wheel', onWheel),
      () => root.removeEventListener('touchstart', onTouchStart),
      () => root.removeEventListener('touchmove', onTouchMove),
      () => root.removeEventListener('touchend', onTouchEnd),
      () => window.removeEventListener('resize', onResize),
    );

    redraw();
    const api = {
      setCenter,
      setMarker,
      setProvider,
      getView(){ return { lat: view.cy, lng: view.cx, zoom: view.zoom, provider: currentProvider }; },
      toggleOverlay(key){ if (key in overlayState){ overlayState[key] = !overlayState[key]; buildOverlayButtons(); redraw(); } },
      destroy(){
        listeners.forEach(fn => { try { fn(); } catch(e) {} });
        root.__gpsMapDestroy = null;
      }
    };
    root.__gpsMapDestroy = api.destroy;
    return api;
  }

  function renderListingMap(container, listing, opts={}){
    const point = readLatLng(listing || {});
    const map = create(container, { center: point, zoom: Number(opts.zoom || DEFAULT_ZOOM), provider: opts.provider || DEFAULT_PROVIDER });
    if (!map) return null;
    const label = opts.label || `${listing?.city || ''}${listing?.province ? ', ' + listing.province : ''}`;
    map.setMarker(point, { label, precision: point.precision === 'exact' ? 'exact' : 'fallback' });
    return { map, point };
  }

  return { create, renderListingMap, readLatLng, listingThumbnailHtml, staticThumbnailUrl, TILE_PROVIDERS };
})();
