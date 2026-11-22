/* Replica runtime: scaling, variant switch, scroll/hover/load/click animations, videos, page arrows.
   Own code. Scroll-animation timing was fitted to the live site (22 Nov 2026):
   start = 0 for pinned widgets, else widget top reaching the viewport bottom (design units);
   length = distance / speed for moves, ~300 / speed for fades (212 / speed for pinned widgets). */
(() => {
  'use strict';
  const D = window.RM;
  const html = document.documentElement;
  const PHONE_MAX = 640;          // below this width the phone layout is used (Readymag switches by device)
  const SCALE_MAX = 3600;         // project scalewidth
  const K = 1;                    // fitted duration factor (700 ms-settled fixtures: exactly distance / speed)

  const EASE = { 'ease-both': [.42, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1], 'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1],
                 'linear': [0, 0, 1, 1], 'ease': [.25, .1, .25, 1], 'ease-out-back': [.34, 1.56, .64, 1], 'ease-in-back': [.36, 0, .66, -.56] };
  const curve = n => EASE[n] || EASE['ease-both'];
  const cssEase = n => `cubic-bezier(${curve(n).join(',')})`;
  function bezier([x1, y1, x2, y2]) {
    return t => {
      if (t <= 0) return 0; if (t >= 1) return 1;
      let lo = 0, hi = 1, u = t;
      for (let i = 0; i < 28; i++) { u = (lo + hi) / 2; const x = 3 * u * (1 - u) * (1 - u) * x1 + 3 * u * u * (1 - u) * x2 + u * u * u; if (x < t) lo = u; else hi = u; }
      return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u * u * u;
    };
  }

  let V = null, root, article, wrapper, bounds, zoom = 1, scrollAnims = [], cleanups = [];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let curY = 0;                   // smoothed scroll position that scroll-linked motion follows (see frame())
  const wid = id => root.querySelector(`.rmwidget[data-id="${id}"]`);
  const clamp01 = t => Math.min(1, Math.max(0, t));
  const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // animation-containers wrapping a widget, outermost first: one per animation that has steps
  function containersOf(el) {
    const out = []; let p = el.parentElement;
    while (p && (p.classList.contains('animation-container') || p.tagName === 'A')) {   // linked widgets sit inside an <a>
      if (p.tagName !== 'A') out.unshift(p);
      p = p.parentElement;
    }
    return out;
  }

  // lengths of the motion-path segments the viewer drew for this box (it adapts phone paths to the screen)
  const SVGNS = 'http://www.w3.org/2000/svg';
  function pathLens(box) {
    const m = /path\("([^"]*)"\)/.exec(box.style.offsetPath || '');
    if (!m) return [];
    return m[1].split(/(?=M)/).map(seg => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', seg); return p.getTotalLength(); });
  }

  // ---------- scroll ----------
  function buildScroll(rec, a, box, top) {
    const st0 = a.steps[0];
    const segs = pathLens(box);
    let at = 0, mi = 0;
    const y = Number.isFinite(top) ? top : rec.y;        // group containers carry the real position
    const steps = a.steps.map(st => {
      const dataLen = st.use_move ? Math.hypot(st.dx || 0, st.dy || 0) : 0;
      const len = st.use_move ? (segs[mi++] ?? dataLen) : 0;
      const fade = (V === 'desk' && rec.fixed) ? 212 : 300;   // fitted: pinned desktop fades run shorter
      const dur = Math.max(1, st.use_move ? (len / st.speed) * K : fade / st.speed);
      const s = { st, len, dur, ease: bezier(curve(st.acceleration)), off: at + (st.delay_px || 0) };
      at = s.off + dur; return s;
    });
    const init = { rotate: 0, scale: 100, opacity: 100 };
    for (const p of ['rotate', 'scale', 'opacity']) {
      const first = a.steps.find(st => st['use_' + p]);
      if (first && first['from_' + p] !== undefined) init[p] = first['from_' + p];
    }
    const uses = p => a.steps.some(st => st['use_' + p]);
    const useMove = uses('move'), useRot = uses('rotate'), useScale = uses('scale'), useOp = uses('opacity');
    // refinement: land a pinned, centre-anchored flyer at a fixed height whatever the screen height (the pencil cup
    // flies into the nav bar; on 16:10 laptops the original path ended below the bar, over the work grid)
    const landY = box.dataset.rmLandY !== undefined ? +box.dataset.rmLandY : null;
    const pm = landY === null ? null : /^M\s*([-\d.]+)\s+([-\d.]+).*?([-\d.]+)\s+([-\d.]+)\s*$/.exec(((/path\("([^"]*)"\)/.exec(box.style.offsetPath || '') || [])[1] || '').trim());
    const totalLen = steps.reduce((t, k) => t + k.len, 0);
    return vh => {
      const sp = st0.start_point || 'bottom', off = st0.start_offset || 0;
      const base = rec.fixed ? 0 : Math.max(0, (sp === 'top' ? y : sp === 'center' ? y - vh / 2 : y - vh));
      const s = curY - base - off;
      let dist = 0; const cur = { ...init };
      for (const k of steps) {
        const e = k.ease(Math.min(Math.max((s - k.off) / k.dur, 0), 1));
        if (k.st.use_move) dist += k.len * e;
        for (const p of ['rotate', 'scale', 'opacity']) {
          if (!k.st['use_' + p]) continue;
          const from = k.st['from_' + p] !== undefined ? k.st['from_' + p] : cur[p];
          cur[p] = from + (k.st[p] - from) * e;
        }
        if (s < k.off) break;
      }
      if (useMove) box.style.offsetDistance = dist + 'px';
      if (pm && totalLen) box.style.translate = `0 ${(landY - (vh / 2 + parseFloat(box.style.marginTop || 0) + +pm[4])) * dist / totalLen}px`;
      if (useRot || useScale) box.style.transform = `rotate(${cur.rotate}deg) scale(${cur.scale / 100})`;
      if (useOp) { box.style.opacity = cur.opacity / 100; box.style.visibility = cur.opacity <= 0.5 ? 'hidden' : ''; }   // faded-out layers must not block the pointer
    };
  }

  // ---------- time-based (hover / load / click) ----------
  function keyframes(a, box) {
    const from = {}, to = {};
    const st = a.steps[0];
    const segs = pathLens(box);
    let total = 0, mi = 0;
    for (const s of a.steps) if (s.use_move) total += segs[mi++] ?? Math.hypot(s.dx || 0, s.dy || 0);
    if (a.steps.some(s => s.use_move)) { from.offsetDistance = '0px'; to.offsetDistance = total + 'px'; }
    if (a.steps.some(s => s.use_opacity)) { from.opacity = (st.from_opacity ?? 100) / 100; to.opacity = (a.steps[a.steps.length - 1].opacity ?? 100) / 100; }
    return [from, to];
  }
  function timeAnim(box, a) {
    const st = a.steps[0];
    const dur = Math.max(1, a.steps.reduce((t, s) => t + (s.duration || 0), 0) * 1000);
    const opts = { duration: dur, easing: cssEase(st.acceleration), fill: 'both' };
    if (a.type === 'load' && st.loop) { opts.iterations = Infinity; if (st.loop === 'swing') opts.direction = 'alternate'; }
    return box.animate(keyframes(a, box), opts);
  }
  // a click-toggled layer that has faded out must not catch taps meant for what is under it (the live viewer hides it)
  const hideIfFaded = box => { box.style.visibility = parseFloat(getComputedStyle(box).opacity) <= 0.01 ? 'hidden' : ''; };

  function setupAnimations() {
    scrollAnims = []; cleanups.forEach(f => f()); cleanups = [];
    const recs = D.variants[V].anims;
    const byId = id => root.querySelector(`.rmwidget[data-id="${id}"]`);
    const claimed = new WeakSet();                     // grouped widgets share one container: animate it once
    for (const rec of recs) {
      const el = byId(rec.id); if (!el) continue;
      const boxes = containersOf(el);
      const top = boxes.length ? parseFloat(boxes[0].style.top) : NaN;
      rec.anims.forEach((a, i) => {
        const box = boxes[i]; if (!box || claimed.has(box)) return;
        claimed.add(box);
        if (box.classList.contains('rm-static')) return;   // a refinement patch made this layer static
        box.classList.remove('invisible');           // opacity is driven by the animation from here on
        if (a.type === 'scroll') { const f = buildScroll(rec, a, box, top); f.box = box; scrollAnims.push(f); return; }
        const anim = timeAnim(box, a);
        if (a.type === 'load') { anim.play(); return; }
        anim.pause(); anim.currentTime = 0;
        const triggers = (a.trigger.length ? a.trigger.map(byId) : [box]).filter(Boolean);   // no trigger = the whole group
        triggers.push(...root.querySelectorAll(`[data-rm-hover="${rec.id}"]`));              // extra triggers added by patches
        if (a.type === 'hover') {
          // Fingers don't hover. On iPhone, a tap whose "hover" reveals something (e.g. a tile's overlay fading in) is
          // treated as a hover only and the link never opens, tap after tap. The live viewer skips hover on touch too.
          const on = e => { if (e.pointerType === 'touch') return; anim.playbackRate = 1; anim.play(); };
          const off = e => { if (e.pointerType === 'touch') return; anim.playbackRate = -1; anim.play(); };
          triggers.forEach(t => { t.addEventListener('pointerenter', on); t.addEventListener('pointerleave', off);
                                  cleanups.push(() => { t.removeEventListener('pointerenter', on); t.removeEventListener('pointerleave', off); }); });
        } else if (a.type === 'click') {
          let open = false;
          if (triggers.some(t => !box.contains(t))) { hideIfFaded(box); anim.addEventListener('finish', () => hideIfFaded(box)); }   // only if something else can bring it back
          const tog = () => { open = !open; box.style.visibility = ''; anim.playbackRate = open ? 1 : -1; anim.play(); };
          triggers.forEach(t => { t.style.cursor = 'pointer'; t.addEventListener('click', tog); cleanups.push(() => t.removeEventListener('click', tog)); });
        }
        cleanups.push(() => anim.cancel());
      });
    }
  }

  // Scroll-linked motion eases toward the real scroll position instead of jumping with each wheel notch or flick.
  let ticking = false, last = 0;
  function frame(now) {
    const target = wrapper.scrollTop, dt = Math.min(64, last ? now - last : 16.7); last = now;
    curY += (target - curY) * (REDUCED ? 1 : 1 - Math.pow(0.8, dt / 16.7));
    if (Math.abs(target - curY) < 0.3) curY = target;
    const vh = wrapper.clientHeight;
    for (const f of scrollAnims) f(vh);
    if (intro) intro.onScroll();
    aidsUpdate();
    if (curY !== target) requestAnimationFrame(frame); else { ticking = false; last = 0; }
  }
  function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(frame); }
  // Safari pauses muted autoplay video it wrongly thinks is off-screen (scaled, scrolled pages): restart any that is
  // actually on screen, unless the viewer paused it.
  setInterval(() => {
    if (!root || document.hidden) return;
    root.querySelectorAll('video[data-autoplay]').forEach(v => {
      if (!v.src || !v.paused || v.dataset.userPaused || v.ended && !v.loop) return;
      const r = v.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) { v.muted = true; v.play().catch(() => {}); }
    });
  }, 700);

  // ---------- videos ----------
  // videos load and play only when within about a screen of view (keeps phones from downloading every clip at once)
  let vio = null;
  function videos() {
    if (vio) vio.disconnect();
    document.querySelectorAll('video[data-src]').forEach(v => { if (!root.contains(v) && v.src) v.pause(); });
    vio = new IntersectionObserver(entries => {
      for (const en of entries) {
        const v = en.target;
        if (en.isIntersecting) {
          if (!v.src) {
            if (v.hasAttribute('data-autoplay')) { v.muted = true; v.autoplay = true; }   // Safari manages native autoplay best
            v.src = v.dataset.src; v.preload = 'auto';
          }
          if (v.hasAttribute('data-autoplay') && !v.dataset.userPaused) v.play().catch(() => {});
        } else if (v.src) v.pause();
      }
    }, { root: wrapper, rootMargin: '100% 0px 100% 0px' });
    root.querySelectorAll('video[data-src]').forEach(v => {
      vio.observe(v);
      if (v.dataset.wired) return; v.dataset.wired = '1';
      // Readymag custom controls: centred play icon, click toggles play/pause
      const w = v.closest('.rmwidget'); const icon = w && w.querySelector('#custom');
      const sync = () => { if (icon) icon.style.opacity = v.paused ? '' : '0'; };
      v.addEventListener('play', sync); v.addEventListener('pause', sync); v.addEventListener('ended', sync);
      if (w) { w.style.cursor = 'pointer'; w.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        if (!v.src) { v.src = v.dataset.src; v.preload = 'auto'; }
        if (v.paused) { delete v.dataset.userPaused; if (v.hasAttribute('data-sound')) v.muted = false; v.play().catch(() => {}); }
        else { v.dataset.userPaused = '1'; v.pause(); }
      }); }
    });
  }


  // ---------- landing intro (Dev, 22 Nov): one scroll flies into Diya's laptop ----------
  // A copy of the desk scene sits over the page. The first scroll plays a short camera move (time-based, so it never
  // stops half-way): the camera dollies into the laptop screen through layers of depth, the small project icons on
  // the screen grow into the work grid's own tiles, landing exactly on them, and the scene dissolves into the page.
  // Scrolling back up above the grid plays it in reverse. It fails open: a watchdog always finishes a move, and the
  // icons follow the real tiles wherever the page actually is.
  let intro = null;
  const PLANES = [   // back to front: depth (how fast it grows as the camera moves in) and how far it follows the pointer
    { name: 'wall', d: 0.92, px: -0.25 }, { name: 'laptop', d: 1, px: 0 }, { name: 'side', d: 1.22, px: 0.55 },
    { name: 'girl', d: 1.08, px: 0.35 }, { name: 'plants', d: 1.6, px: 1.1 }];
  function setupIntro() {
    if (intro) { intro.destroy(); intro = null; }
    const cfg = D.variants[V].intro;
    if (!cfg || REDUCED) return;
    const planeOf = id => (cfg.planes && Object.keys(cfg.planes).find(k => cfg.planes[k].includes(id))) || (id === cfg.laptop ? 'laptop' : 'side');
    const layer = document.createElement('div'); layer.className = 'rm-intro';
    const planes = PLANES.map(pl => { const el = document.createElement('div'); el.className = 'rm-plane rm-plane-' + pl.name; layer.appendChild(el); return { ...pl, el }; });
    const plane = name => planes.find(p => p.name === name);
    const outer = el => { let o = el; while (o.parentElement && (o.parentElement.classList.contains('animation-container') || o.parentElement.tagName === 'A')) o = o.parentElement; return o; };
    const hidden = [], moved = [], items = [];
    let laptopItem = null, shade = null;
    for (const it of cfg.items) {
      const el = wid(it.id), im0 = el && el.querySelector('img');
      if (!im0) continue;
      const box = document.createElement('div'); box.className = 'rm-intro-item'; box.style.zIndex = it.z;
      const img = new Image(); img.alt = ''; img.decoding = 'async'; img.src = im0.getAttribute('src'); img.style.objectFit = getComputedStyle(im0).objectFit;
      box.appendChild(img);
      const pl = plane(planeOf(it.id)); pl.el.appendChild(box);
      items.push({ it, box, plane: pl.name });
      const o = outer(el); o.classList.add('rm-intro-orig'); hidden.push(o);
      if (it.id === cfg.laptop) {
        laptopItem = it;
        shade = document.createElement('div'); shade.className = 'rm-intro-shade'; shade.style.zIndex = it.z; pl.el.appendChild(shade);
      }
      if (pl.name === 'plants') {                               // a slow, slightly different sway for each plant
        const k = items.length;
        box.classList.add('rm-sway'); box.style.transformOrigin = it.x < 0 ? '0% 25%' : '100% 25%'; box.style.setProperty('--sway-t', (7 + (k * 1.37) % 4).toFixed(2) + 's');
        box.style.setProperty('--sway-d', (-(k * 0.91) % 5).toFixed(2) + 's'); box.style.setProperty('--sway-a', (0.8 + (k * 0.53) % 1).toFixed(2) + 'deg');
      }
    }
    const tiles = [...root.querySelectorAll('.content-scroll-wrapper a.maglink > .rmwidget.widget-picture')]
      .filter(t => parseFloat(t.style.width) >= 200 && !t.closest('.rm-intro-orig'))
      .map(t => ({ href: t.parentElement.getAttribute('href'), img: t.querySelector('img'), x: parseFloat(t.style.left), y: parseFloat(t.style.top), w: parseFloat(t.style.width), h: parseFloat(t.style.height) }))
      .filter(t => t.img).sort((p, q) => p.y - q.y || p.x - q.x).slice(0, 8);
    if (!laptopItem || !tiles.length) { hidden.forEach(o => o.classList.remove('rm-intro-orig')); layer.remove(); return; }
    scrollAnims = scrollAnims.filter(f => !(f.box && f.box.closest('.rm-intro-orig')));   // their originals are hidden now
    // "Scroll to enter" and its arrow scroll with the page on the phone: lift them above the scene
    const hint = document.createElement('div'); hint.className = 'rm-intro-hint'; layer.appendChild(hint);
    root.querySelectorAll('.content-scroll-wrapper .page-content-container > .animation-container, .content-scroll-wrapper .page-content-container > .rmwidget').forEach(o => {
      const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget');
      if (!w || w.matches('.widget-picture') || o.classList.contains('rm-intro-orig')) return;
      if ((parseFloat(o.style.top) || 0) < 300) { moved.push([o, o.parentElement, o.nextSibling]); hint.appendChild(o); }
    });
    const veil = document.createElement('div'); veil.className = 'rm-intro-veil'; layer.appendChild(veil);
    const iconsEl = document.createElement('div'); iconsEl.className = 'rm-icons'; layer.appendChild(iconsEl);
    const icons = tiles.map(t => {
      t.img.loading = 'eager';                                   // the grid must be ready under the scene when it dissolves
      const a = document.createElement('a'); a.className = 'rm-icon'; a.href = t.href; a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1;
      a.style.width = t.w + 'px'; a.style.height = t.h + 'px';
      const im = new Image(); im.alt = t.img.alt || ''; im.src = t.img.getAttribute('src'); a.appendChild(im); iconsEl.appendChild(a); return a;
    });
    if (V === 'phone') article.insertBefore(layer, article.querySelector('.fixed-position-container-top')); else article.appendChild(layer);

    // ---- geometry (re-measured on resize, e.g. a phone's address bar showing or hiding) ----
    let G = null;
    function measure() {
      const VW = article.clientWidth, VH = article.clientHeight;
      let topMin = Infinity, bottom = 0;
      for (const { it, box } of items) {
        const left = it.c ? VW / 2 + it.x - it.w / 2 : it.x, top = it.c ? VH / 2 + it.y - it.h / 2 : it.y;
        Object.assign(box.style, { left: left + 'px', top: top + 'px', width: it.w + 'px', height: it.h + 'px' });
        it._l = left; it._t = top;
        if (it.id !== cfg.wall) { bottom = Math.max(bottom, top + it.h); topMin = Math.min(topMin, top); }
      }
      // tall screens (phones, tablets upright): scale the drawing up about its middle so it fills the height
      const b = Math.min(1.4, Math.max(1, VH / Math.max(1, bottom - Math.max(0, topMin))));
      const [a1, b1, c1, d1] = cfg.screen, L = laptopItem;
      const screen = { x: L._l + a1 * L.w, y: L._t + b1 * L.h, w: (c1 - a1) * L.w, h: (d1 - b1) * L.h };
      Object.assign(shade.style, { left: screen.x + 'px', top: screen.y + 'px', width: screen.w + 'px', height: screen.h + 'px' });
      const Bc = b > 1 ? { x: VW / 2, y: (Math.max(0, topMin) + bottom) / 2 } : { x: 0, y: 0 }, Bo = b > 1 ? { x: VW / 2, y: VH / 2 } : Bc;
      const B = p => ({ x: Bo.x + (p.x - Bc.x) * b, y: Bo.y + (p.y - Bc.y) * b });
      const O = B({ x: screen.x + screen.w / 2, y: screen.y + screen.h / 2 });          // screen centre, as seen at rest
      const K = Math.max(VW / (screen.w * b), VH / (screen.h * b)) * 1.06;
      const cols = 4, iw = screen.w * 0.15, gap = (screen.w - cols * iw) / (cols + 1);
      const slots = tiles.map((t, i) => { const h = iw * t.h / t.w, r = Math.floor(i / cols);
        return { x: screen.x + gap + (i % cols) * (iw + gap), y: screen.y + screen.h * 0.11 + r * (h + screen.h * 0.07), w: iw }; });
      G = { VW, VH, b, Bc, Bo, O, K, slots };
    }
    // a plane at depth d, camera progress e: scene point x -> O + t + s (B(x) - O), with s = K^(e d) and
    // B(x) = Bo + b (x - Bc); as one affine map: x -> A + k x
    function planeMap(d, e, par) {
      const s = Math.pow(G.K, e * d), t = { x: (G.VW / 2 - G.O.x) * e + par.x, y: (G.VH / 2 - G.O.y) * e + par.y };
      const k = s * G.b;
      return { k, A: { x: G.O.x + t.x + s * (G.Bo.x - G.O.x) - k * G.Bc.x, y: G.O.y + t.y + s * (G.Bo.y - G.O.y) - k * G.Bc.y } };
    }

    // ---- drawing one moment of the move ----
    let P = 0, ptr = { x: 0, y: 0 }, ptrT = { x: 0, y: 0 }, idle = 0;
    function render() {
      if (!G) return;
      layer.classList.add('rm-moving'); clearTimeout(idle); idle = setTimeout(() => layer.classList.remove('rm-moving'), 200);
      // 0 -> .62 the camera flies in; .45 -> .72 screen and scene darken; .55 -> .95 icons rearrange into the grid;
      // .9 -> 1 the scene dissolves into the real page
      const e = easeIO(clamp01(P / 0.62));
      let lap = null;
      for (const pl of planes) {
        const par = { x: ptr.x * pl.px * 9 * (1 - e), y: ptr.y * pl.px * 6 * (1 - e) };
        const m = planeMap(pl.d, e, par);
        pl.el.style.transform = `translate(${m.A.x}px, ${m.A.y}px) scale(${m.k})`;
        if (pl.d > 1.05) pl.el.style.opacity = 1 - clamp01((m.k - 2.4) / 2.6);   // near layers rush past and dissolve
        if (pl.name === 'laptop') lap = m;
      }
      shade.style.opacity = clamp01((P - 0.45) / 0.25);
      veil.style.opacity = clamp01((P - 0.52) / 0.2);
      hint.style.opacity = 1 - clamp01(P * 6);
      const q = easeIO(clamp01((P - 0.55) / 0.4)), st = wrapper.scrollTop;
      icons.forEach((a, i) => {
        const sl = G.slots[i], t = tiles[i];
        const vx = lap.A.x + lap.k * sl.x, vy = lap.A.y + lap.k * sl.y, vw = sl.w * lap.k;        // on the laptop screen
        const x = vx + (t.x - vx) * q, y = vy + (t.y - st - vy) * q, k = (vw + (t.w - vw) * q) / t.w;  // ...growing onto its tile
        a.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        a.style.borderRadius = (2.5 * (1 - q)) / k + 'px';
      });
      layer.style.opacity = 1 - clamp01((P - 0.9) / 0.1);
      layer.style.visibility = P >= 1 ? 'hidden' : '';
    }

    // ---- the moves ----
    // where the move lands: her Work position, or on the phone just clear of the nav bar above the first tile
    const END = V === 'phone' ? Math.min(cfg.end, Math.round(tiles[0].y - 62)) : cfg.end, FWD = 1900, BACK = 1500, REV = END - 140;
    let state = 'scene', anim = null, cooldown = 0, dog = 0;
    function play(to) {
      if (anim) return;
      state = to ? 'toGrid' : 'toScene';
      const from = P, span = Math.abs(to - from) * (to ? FWD : BACK);
      const t0 = performance.now();
      if (to && wrapper.scrollTop < END) wrapper.scrollTo({ top: END, behavior: 'smooth' });   // only towards the grid, never pulled back
      if (!to && wrapper.scrollTop > 2) wrapper.scrollTo({ top: 0, behavior: 'smooth' });
      const finish = () => { cancelAnimationFrame(anim); anim = null; clearTimeout(dog); P = to; render(); state = to ? 'grid' : 'scene'; cooldown = performance.now() + 600; };
      const step = now => { P = from + (to - from) * clamp01((now - t0) / Math.max(1, span)); render(); if (P === to) finish(); else anim = requestAnimationFrame(step); };
      anim = requestAnimationFrame(step);
      dog = setTimeout(() => { if (anim) finish(); }, span + 1500);   // never leave the page under the scene
    }
    let lastY = wrapper.scrollTop;
    function onScrollIntro() {
      const y = wrapper.scrollTop, dir = y - lastY; lastY = y;
      if (anim || performance.now() < cooldown) return;
      if (state === 'scene' && y > 6 && dir > 0) play(1);
      else if (state === 'grid' && y < REV && dir < 0) play(0);   // only when actually heading back up
      else render();                                              // keep the (hidden) icons tracking the tiles
    }
    const onHide = () => { if (document.hidden && anim) { P = state === 'toGrid' ? 1 : 0; render(); cancelAnimationFrame(anim); anim = null; state = P ? 'grid' : 'scene'; } };
    document.addEventListener('visibilitychange', onHide);
    // laptops: the scene leans a little toward the pointer while it is at rest
    let pAnim = 0;
    const onMove = e => {
      if (P > 0 || e.pointerType === 'touch') return;
      ptrT = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
      if (!pAnim) pAnim = requestAnimationFrame(function glide() {
        ptr.x += (ptrT.x - ptr.x) * 0.08; ptr.y += (ptrT.y - ptr.y) * 0.08; render();
        pAnim = Math.abs(ptrT.x - ptr.x) + Math.abs(ptrT.y - ptr.y) > 0.002 ? requestAnimationFrame(glide) : 0;
      });
    };
    if (matchMedia('(hover: hover)').matches) addEventListener('pointermove', onMove, { passive: true });

    measure();
    if (wrapper.scrollTop >= END - 2) { P = 1; state = 'grid'; }   // arrived at the grid (#y..., Work, back from a project)
    render();
    intro = {
      variant: V, onScroll: onScrollIntro, measure() { measure(); render(); },
      images: [...layer.querySelectorAll('img')],
      arrive() { if (P > 0) return; layer.classList.add('rm-arrive'); layer.addEventListener('animationend', () => layer.classList.remove('rm-arrive'), { once: true }); },
      workTop: pos => (pos === cfg.end ? END : pos),   // her Work anchor lands where the move lands
      get state() { return state; },
      destroy() {
        cancelAnimationFrame(anim); cancelAnimationFrame(pAnim); clearTimeout(dog);
        removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onHide);
        layer.remove(); hidden.forEach(o => o.classList.remove('rm-intro-orig'));
        moved.forEach(([o, par, next]) => par.insertBefore(o, next && next.parentElement === par ? next : null));
      },
    };
  }

  // ---------- finish ----------
  // top bars become frosted black glass; images ease in as they scroll into view
  function decorate() {
    const W = D.variants[V].w;
    root.querySelectorAll('.fixed-position-container .rmwidget.widget-shape, .fixed-position-container-top .rmwidget.widget-shape').forEach(sh => {
      const w = parseFloat(sh.style.width), h = parseFloat(sh.style.height);
      if (w >= W * 0.9 && h > 20 && h < 70) sh.classList.add('rm-navbar');
    });
    // describe the landing tiles by their project names (screen readers, link scrapers)
    if (D.names) root.querySelectorAll('.content-scroll-wrapper a.maglink > .rmwidget.widget-picture img').forEach(im => {
      const m = /\/(\d+)\/$/.exec(im.closest('a').getAttribute('href') || ''); const name = m && D.names[m[1]];
      if (name && !im.alt) im.alt = name;
    });
    // laptop nav: About / Contact are plain words on most project pages; make them go somewhere
    if (V === 'desk') root.querySelectorAll('.fixed-position-container .rmwidget.widget-text-v3, .fixed-position-container-top .rmwidget.widget-text-v3').forEach(t => {
      const word = t.textContent.trim().toLowerCase();
      if (!['about', 'contact'].includes(word) || t.querySelector('a') || t.dataset.rmLink) return;
      const href = word === 'about' ? url(SITE.about) : SITE.contact;
      t.dataset.rmLink = href; t.setAttribute('role', 'link'); t.tabIndex = 0; t.style.cursor = 'pointer';
      t.addEventListener('click', () => { location.href = href; });
      t.addEventListener('keydown', e => { if (e.key === 'Enter') location.href = href; });
    });
  }
  let rio = null;
  function reveals() {
    if (rio) rio.disconnect();
    if (REDUCED || !('IntersectionObserver' in window)) return;
    rio = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('rm-in'); rio.unobserve(en.target); } }),
                                   { root: wrapper, rootMargin: '0px 0px -6% 0px' });
    const pics = root.querySelectorAll('.content-scroll-wrapper .page-content-container > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > a > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > .rmwidget.video');
    pics.forEach(el => {
      if (el.closest('.rm-intro-orig') || (D.variants[V].intro && el.closest('a.maglink') && parseFloat(el.style.width) >= 200)) return;   // the intro owns the grid
      if (el.classList.contains('rm-in')) return;
      el.classList.add('rm-rv'); rio.observe(el);
    });
  }



  // ---------- long project pages: reading progress + back to top ----------
  let progBits = [];
  function pageAids() {
    progBits.forEach(x => x.remove()); progBits = [];
    if (D.num === 1) return;
    const bar = document.createElement('div'); bar.className = 'rm-progress'; bar.innerHTML = '<i></i>';
    const up = document.createElement('button'); up.className = 'rm-totop'; up.type = 'button'; up.setAttribute('aria-label', 'Back to top');
    up.innerHTML = '<svg viewBox="0 0 16 16"><polyline points="3,10 8,5 13,10"/></svg>';
    up.addEventListener('click', () => wrapper.scrollTo({ top: 0, behavior: 'smooth' }));
    article.append(bar, up); progBits = [bar, up];
    bar.style.zoom = up.style.zoom = 1 / zoom;                 // sized in screen pixels, whatever the page scale
  }
  function aidsUpdate() {
    if (!progBits.length) return;
    const [bar, up] = progBits, max = wrapper.scrollHeight - wrapper.clientHeight;
    bar.firstChild.style.transform = `scaleX(${max > 0 ? wrapper.scrollTop / max : 0})`;
    up.classList.toggle('rm-on', wrapper.scrollTop > wrapper.clientHeight * 2.5);
  }

  // ---------- phone menu (Dev, 22 Nov: the solid purple panel "looks very ew") ----------
  // Readymag's hamburger, cross and panel give way to a full-screen frosted-black menu with large type. Same
  // destinations as hers (About, Contact), plus Work, which jumps to the landing page's work grid.
  const MENU = { burger: 'f90e8a', cross: 'e9e29c', panel: 'e6ec15', links: 'cd0e1d' };
  // her own destinations, used where a page lacks the Readymag menu or nav links (page 9 on the phone, About/Contact
  // as plain text on most project pages on the laptop; the same on her live Readymag)
  const SITE = { about: 10, contact: 'http://www.linkedin.com/in/diyakamra', email: 'mailto:diyakamra1019@gmail.com', work: 583 };
  let menuBits = [];
  const closeMenu = () => html.classList.remove('rm-menu-open');
  function phoneMenu() {
    menuBits.forEach(x => x.remove()); menuBits = []; closeMenu();
    const find = suf => root.querySelector(`.rmwidget[data-id$="${suf}"]`);
    const burger = find(MENU.burger), links = find(MENU.links);
    if (V !== 'phone') return;
    const outerOf = el => { let o = el; while (o.parentElement && (o.parentElement.classList.contains('animation-container') || o.parentElement.tagName === 'A')) o = o.parentElement; return o; };
    Object.values(MENU).forEach(s => { const el = find(s); if (el) outerOf(el).classList.add('rm-hide'); });
    const nice = t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    const work = root.querySelector('a.anchor-link[data-page-uri="1"]');
    const workPos = work ? +work.dataset.anchorLinkPos : SITE.work;
    const own = links ? [...links.querySelectorAll('a[href]')].map(a => ({ label: nice(a.textContent.trim()), href: a.getAttribute('href') })) : [];
    const items = [{ label: 'Work', href: D.num === 1 ? '#' : url(1) + '#y' + workPos, work: D.num === 1 },
                   ...(own.length ? own : [{ label: 'About', href: url(SITE.about) }, { label: 'Contact', href: SITE.contact }])];
    const mail = root.querySelector('a[href^="mailto:"]') || { getAttribute: () => SITE.email };
    const li = [...root.querySelectorAll('a[href*="linkedin.com"]')][0] || { getAttribute: () => SITE.contact };
    const btn = document.createElement('button'); btn.className = 'rm-menu-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Menu'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = '<span></span><span></span>';
    const nav = document.createElement('nav'); nav.className = 'rm-menu'; nav.setAttribute('aria-label', 'Menu');
    const ul = document.createElement('ul');
    items.forEach((it, i) => {
      const liEl = document.createElement('li'); liEl.style.setProperty('--i', i);
      const a = document.createElement('a'); a.href = it.href;
      a.innerHTML = `<small>${String(i + 1).padStart(2, '0')}</small><span></span>`; a.lastChild.textContent = it.label;
      a.addEventListener('click', e => {
        if (it.work) { e.preventDefault(); wrapper.scrollTo({ top: intro ? intro.workTop(workPos) : workPos, behavior: 'smooth' }); }
        closeMenu(); btn.setAttribute('aria-expanded', 'false');
      });
      liEl.appendChild(a); ul.appendChild(liEl);
    });
    const foot = document.createElement('div'); foot.className = 'rm-menu-foot';
    if (mail) { const a = document.createElement('a'); a.href = mail.getAttribute('href'); a.textContent = mail.getAttribute('href').replace(/^mailto:/, ''); foot.appendChild(a); }
    if (li) { const a = document.createElement('a'); a.href = li.getAttribute('href'); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'LinkedIn ↗'; foot.appendChild(a); }
    nav.append(ul, foot);
    btn.addEventListener('click', () => { const open = html.classList.toggle('rm-menu-open'); btn.setAttribute('aria-expanded', String(open)); });
    article.append(nav, btn); menuBits = [nav, btn];
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  // ---------- arrows + keys ----------
  const BASE = D.base || '';      // set when hosted under a sub-path (e.g. GitHub Pages project site)
  const url = n => BASE + (n === 1 ? '/' : `/${n}/`);
  function arrows() {
    document.querySelectorAll('.rm-arrows').forEach(x => x.remove());
    const show = (V === 'desk' ? D.arrows : D.phoneArrows) && D.num > 1;   // the landing page needs no project arrows
    if (!show) return;
    const wrap = document.createElement('div'); wrap.className = 'rm-arrows';
    const mk = (dir, n) => {
      const a = document.createElement('a'); a.className = 'rm-arrow ' + dir; a.href = url(n);
      a.setAttribute('aria-label', dir === 'left' ? 'Previous page' : 'Next page');
      a.innerHTML = `<svg viewBox="0 0 18 34"><polyline points="${dir === 'left' ? '17,1 1,17 17,33' : '1,1 17,17 1,33'}"/></svg>`;
      wrap.appendChild(a);
    };
    if (D.num > 1) mk('left', D.num - 1);
    if (D.num < D.total) mk('right', D.num + 1);
    article.appendChild(wrap);
    wrap.style.zoom = 1 / zoom;
  }
  // Readymag anchor links ("Work", "Scroll Up", the phone "Home"): go to a position on a page, in design units,
  // smooth-scrolled like the live viewer; on another page, after loading it (#y<pos>)
  const anchorOf = t => t && t.closest && t.closest('a.anchor-link[data-anchor-link-pos]');
  addEventListener('click', e => {
    const a = anchorOf(e.target); if (!a) return;
    e.preventDefault();
    const pos = +a.dataset.anchorLinkPos, n = +a.dataset.pageUri || D.num;
    if (n === D.num) wrapper.scrollTo({ top: intro ? intro.workTop(pos) : pos, behavior: 'smooth' });
    else location.href = url(n) + '#y' + pos;
  });
  addEventListener('keydown', e => {
    if (e.key === 'Enter' && anchorOf(e.target)) { anchorOf(e.target).click(); return; }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' && D.num < D.total) location.href = url(D.num + 1);
    if (e.key === 'ArrowLeft' && D.num > 1) location.href = url(D.num - 1);
    // keyboard scrolling goes to the page's scroller wherever focus is
    const page = wrapper.clientHeight * 0.9;
    const step = { ArrowDown: 60, ArrowUp: -60, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
    if (step !== undefined) { e.preventDefault(); wrapper.scrollTop += step; }
    if (e.key === 'Home') wrapper.scrollTop = 0;
    if (e.key === 'End') wrapper.scrollTop = wrapper.scrollHeight;
  });
  // Pinned (fixed) layers sit outside the scroller. Safari/Firefox don't hand their wheel events to it,
  // so forward them (the live viewer does the same with its own wheel handling).
  addEventListener('wheel', e => {
    if (!wrapper || wrapper.contains(e.target) || e.ctrlKey || html.classList.contains('rm-menu-open')) return;      // native scroll inside; ctrl = pinch zoom
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    wrapper.scrollTop += (e.deltaY * unit) / zoom;
  }, { passive: false });
  const numOf = u => { try { const m = new URL(u).pathname.slice(BASE.length).match(/^\/(\d+)\/?$/); return m ? +m[1] : 1; } catch (e) { return 0; } };
  addEventListener('pageswap', e => {
    const to = e.activation && e.activation.entry && numOf(e.activation.entry.url);
    if (e.viewTransition && to) e.viewTransition.types.add(to > D.num ? 'forward' : 'backward');
  });
  addEventListener('pagereveal', e => {
    const from = window.navigation && navigation.activation && navigation.activation.from && numOf(navigation.activation.from.url);
    if (e.viewTransition && from) e.viewTransition.types.add(D.num > from ? 'forward' : 'backward');
  });

  // ---------- layout ----------
  function activate(v) {
    V = v; html.dataset.v = v;
    root = document.getElementById('v-' + v);
    article = root.querySelector('article.page');
    wrapper = article.querySelector('.content-scroll-wrapper');
    bounds = article.querySelector('.content-bounds');
    document.querySelectorAll('.content-scroll-wrapper').forEach(w => w.removeEventListener('scroll', onScroll));
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    curY = wrapper.scrollTop;
    setupAnimations(); videos(); decorate(); phoneMenu();
  }
  function layout() {
    const v = innerWidth < PHONE_MAX ? 'phone' : 'desk';
    if (v !== V) activate(v);
    const W = D.variants[V].w;
    zoom = Math.min(innerWidth, SCALE_MAX) / W;
    html.style.zoom = zoom;
    const aw = innerWidth / zoom, ah = innerHeight / zoom;
    article.style.width = aw + 'px'; article.style.height = ah + 'px';
    bounds.style.minHeight = ah + 'px';
    arrows(); pageAids(); if (!intro || intro.variant !== V) setupIntro(); else intro.measure(); reveals(); onScroll();
  }
  addEventListener('resize', layout);
  layout();
  // ---------- loading screen (landing page, first visit in a session) ----------
  (function loader() {
    const el = document.getElementById('rm-loader');
    if (!el) return;
    if (html.classList.contains('rm-noload')) { el.remove(); return; }
    el.style.zoom = 1 / zoom;                                  // keep its size whatever the page scale
    const bar = el.querySelector('.rm-loader-bar i');
    const list = intro ? intro.images : [...root.querySelectorAll('img')].slice(0, 16);
    const t0 = performance.now(); let shown = 0.03, ended = false;
    const finish = () => {
      if (ended) return; ended = true;
      bar.style.setProperty('--p', 1);
      setTimeout(() => {
        el.classList.add('rm-done'); if (intro) intro.arrive();
        try { sessionStorage.setItem('rm-seen', '1'); } catch (e) {}
        setTimeout(() => el.remove(), 1000);
      }, 320);
    };
    (function tick() {
      if (ended) return;
      const frac = list.length ? list.filter(im => im.complete).length / list.length : 1, t = performance.now() - t0;
      shown += (Math.max(frac, Math.min(0.9, t / 4000)) - shown) * 0.15;       // never looks stuck
      bar.style.setProperty('--p', shown.toFixed(3));
      if ((frac >= 1 && t > 1200) || t > 5000) finish(); else requestAnimationFrame(tick);
    })();
    setTimeout(finish, 5600);
  })();
  const jump = /^#y(\d+)$/.exec(location.hash);
  if (jump) { wrapper.scrollTop = curY = intro ? intro.workTop(+jump[1]) : +jump[1]; history.replaceState(null, '', location.pathname + location.search); if (intro) intro.measure(); onScroll(); }
  window.__rm = { get zoom() { return zoom; }, get variant() { return V; }, get wrapper() { return wrapper; } };
})();
