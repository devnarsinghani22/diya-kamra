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
  let scrollHeld = false;         // the landing intro holds the page still while its move plays (see setupIntro)
  const wid = id => root.querySelector(`.rmwidget[data-id="${id}"]`);
  const clamp01 = t => Math.min(1, Math.max(0, t));
  const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  // her load animations (e.g. the About page figure walking in) start once the page has arrived, as in the live viewer,
  // which starts them ~0.7 s after opening a page; started at once they finish before anyone sees them
  const LOAD_DELAY = 700;
  // "Scroll to enter" pulsed between 11% and 71% opacity: hard to see on the dark scene. Same pulse, brighter (26 Nov).
  const HINT_IDS = ['6afe2ac4d5e1c0276569f18f', '6b02d66c7bf161fe4b5cb7ae', '6b02d6bfdc99aa72f2f5f195'];
  for (const vv of Object.values(D.variants)) for (const r of vv.anims || []) if (HINT_IDS.includes(r.id))
    for (const a of r.anims) if (a.type === 'load') for (const st of a.steps) { if (st.use_opacity) { st.from_opacity = 35; st.opacity = 95; } }

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
      const fromPath = st.use_move && segs[mi] !== undefined;
      // her path's own length: Firefox measures offset-distance on screen, so even along a path scaled up for it
      // (see scalePaths) distances and timings stay in her units
      const len = st.use_move ? (fromPath ? segs[mi++] * motionK : dataLen) : 0;
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
      if (pm && totalLen) box.style.translate = `0 ${(landY - (vh / 2 + parseFloat(box.style.marginTop || 0) + +pm[4] * motionK)) * dist / totalLen}px`;
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
    for (const s of a.steps) if (s.use_move) total += segs[mi] !== undefined ? segs[mi++] * motionK : Math.hypot(s.dx || 0, s.dy || 0);
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

  // Firefox applies the page zoom to motion-path coordinates (offset-path) a second time: every element inside one of
  // her animation wrappers lands short by (1 - 1/zoom) of its path point. Probe the engine once per layout; where paths
  // shrink, write them back scaled up by the same factor. Chrome and Safari probe 1 and keep her paths untouched.
  let motionK = 1;
  function probeMotion() {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;offset-path:path("M 105 5");offset-distance:0px;offset-rotate:0deg;visibility:hidden';
    article.appendChild(d);
    const a = article.getBoundingClientRect(), r = d.getBoundingClientRect(), f = a.width / article.clientWidth || 1;
    d.remove();
    const x = (r.left - a.left) / f + 5;          // where the probe's centre landed, in design px (should be 105)
    return x > 1 && Math.abs(x - 105) > 0.5 ? x / 105 : 1;
  }
  function scalePaths(k) {
    root.querySelectorAll('.animation-container').forEach(c => {
      const orig = c.dataset.rmPath || c.style.offsetPath;
      if (!/path\(/.test(orig || '')) return;
      c.dataset.rmPath = orig;
      c.style.offsetPath = k === 1 ? orig : orig.replace(/-?\d+(\.\d+)?/g, n => (+n / k).toFixed(3));
    });
  }

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
        if (a.type === 'load') { anim.pause(); anim.currentTime = 0; const t = setTimeout(() => anim.play(), LOAD_DELAY); cleanups.push(() => clearTimeout(t), () => anim.cancel()); return; }
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
    curY += (target - curY) * (REDUCED ? 1 : 1 - Math.pow(0.55, dt / 16.7));   // ~0.1 s glide: close to her 1:1 original
    if (Math.abs(target - curY) < 0.3) curY = target;
    const vh = wrapper.clientHeight;
    for (const f of scrollAnims) f(vh);
    if (intro) intro.onScroll();
    aidsUpdate(); arrowsUpdate(); if (pending.length) revealTick();
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
    let introTitle = null;
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
    // her name, what she does and NID on the first screen (Dev, 26 Nov: "make the fact that Diya is from NID more
    // prominent"): above "Scroll to enter", fading out with the scene as the move starts
    {
      const words = [...root.querySelectorAll('.rmwidget.widget-text-v3')].find(w => /^\s*scroll\s*to\s*enter\s*$/i.test(w.textContent));
      const title = document.createElement('div'); title.className = 'rm-intro-title';
      title.innerHTML = '<strong>Diya Kamra</strong><em>Communication Designer &middot; NID 2026</em>';
      hint.appendChild(title);
      introTitle = { el: title, words };
    }
    // the laptop layout has the words but no arrow (the phone has one): add the same small down-arrow under the words,
    // drifting down with the same 1.6 s pulse (26 Nov)
    if (V === 'desk' && !root.querySelector('.rm-hint-arrow')) {
      const words = [...root.querySelectorAll('.rmwidget.widget-text-v3')].find(w => /^\s*scroll\s*to\s*enter\s*$/i.test(w.textContent));
      if (words) {
        let box = words; while (box.parentElement && box.parentElement.classList.contains('animation-container')) box = box.parentElement;
        const arrow = document.createElement('div'); arrow.className = 'rm-hint-arrow';   // inside her wrapper: fades out with the words on scroll
        arrow.innerHTML = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M5 1v13M1 10l4 4 4-4"/></svg>';
        arrow.style.left = (box.offsetWidth / 2 - 5) + 'px'; arrow.style.top = (box.offsetHeight + 3) + 'px';
        box.appendChild(arrow);
      }
    }

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
      if (introTitle && introTitle.words) {
        const fz = article.getBoundingClientRect().width / article.offsetWidth || 1, hr = hint.getBoundingClientRect(), wr = introTitle.words.getBoundingClientRect();
        const t = introTitle.el; t.style.left = ((wr.left + wr.width / 2 - hr.left) / fz) + 'px';
        t.style.top = Math.max(V === 'phone' ? 30 : 12, (wr.top - hr.top) / fz - t.offsetHeight - (V === 'phone' ? 22 : 16)) + 'px';
      }
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
      const q = easeIO(clamp01((P - 0.55) / 0.4)), st = stFix !== null ? stFix : wrapper.scrollTop;
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
    let state = 'scene', anim = null, cooldown = 0, dog = 0, stFix = null, settleT = 0;
    // While a move plays the opaque scene covers the page, so the page is put where the move ends at once and held
    // there: the icons fly onto tiles that stay still, and a wheel or flick that keeps going can't drag the grid
    // around under them (Dev, 26 Nov: "the scroll to enter is feeling a bit jittery"). Every exit lets go.
    const jumpTo = y => { wrapper.scrollTop = y; curY = wrapper.scrollTop; lastY = curY; };
    const hold = on => { scrollHeld = on; wrapper.style.overflowY = on ? 'hidden' : ''; };
    function play(to) {
      if (anim) return;
      state = to ? 'toGrid' : 'toScene';
      const from = P, span = Math.abs(to - from) * (to ? FWD : BACK);
      const t0 = performance.now();
      hold(true);
      if (to && wrapper.scrollTop < END) jumpTo(END);   // only towards the grid, never pulled back
      stFix = wrapper.scrollTop;
      let atTop = !!to || wrapper.scrollTop <= 2;
      const finish = () => { cancelAnimationFrame(anim); anim = null; clearTimeout(dog); if (!atTop) jumpTo(0); P = to; stFix = null; render(); state = to ? 'grid' : 'scene'; hold(false); cooldown = performance.now() + 600;
        clearTimeout(settleT); settleT = setTimeout(settle, 650); };
      const step = now => {
        P = from + (to - from) * clamp01((now - t0) / Math.max(1, span));
        if (!atTop && P < 0.88) { atTop = true; jumpTo(0); }   // going back: the scene is opaque again, so go to the top
        render(); if (P === to) finish(); else anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
      dog = setTimeout(() => { if (anim) finish(); }, span + 1500);   // never leave the page under the scene
    }
    let lastY = wrapper.scrollTop;
    // Dev, 26 Nov (phone): "sometimes the website is getting stuck" on a black screen. A flick back up in the 0.6 s
    // after the move into the grid (when scrolling is ignored, so one gesture can't bounce the move) carried the page
    // to the top while the intro still thought it was at the grid: the black top of the page, nothing to bring the
    // scene back. Once the pause is over, look at where the page really is and put the scene right.
    function settle() {
      if (anim || !G) return;
      const y = wrapper.scrollTop; lastY = y;
      if (state === 'grid' && y < REV) play(0);
    }
    function onScrollIntro() {
      const y = wrapper.scrollTop, dir = y - lastY; lastY = y;
      if (anim || performance.now() < cooldown) return;
      if (state === 'scene' && y > 6 && dir > 0) play(1);
      else if (state === 'grid' && y < REV && (dir < 0 || y < REV / 2)) play(0);   // heading back up, or already near the top
      else if (P < 1) render();                                   // the scene is gone at P = 1: nothing to redraw
    }
    // a tap or click on the scene (not on a link) also enters
    const onTap = e => { if (state === 'scene' && !anim && !(e.target.closest && e.target.closest('a, button'))) { lastY = wrapper.scrollTop; play(1); } };
    wrapper.addEventListener('click', onTap);
    const onHide = () => { if (document.hidden && anim) { cancelAnimationFrame(anim); anim = null; clearTimeout(dog); P = state === 'toGrid' ? 1 : 0; if (!P && wrapper.scrollTop > 2) jumpTo(0); stFix = null; render(); state = P ? 'grid' : 'scene'; hold(false); } };
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
      // arrived already at the grid (Home / menu Work from a project page): show the page, don't replay the move
      sync() { if (anim) return; lastY = wrapper.scrollTop; if (lastY >= END - 2) { P = 1; state = 'grid'; } measure(); render(); },
      get state() { return state; },
      destroy() {
        cancelAnimationFrame(anim); cancelAnimationFrame(pAnim); clearTimeout(dog); clearTimeout(settleT); if (anim) hold(false); anim = null;
        removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onHide); wrapper.removeEventListener('click', onTap);
        layer.remove(); hidden.forEach(o => o.classList.remove('rm-intro-orig'));
        moved.forEach(([o, par, next]) => par.insertBefore(o, next && next.parentElement === par ? next : null));
      },
    };
  }

  // ---------- finish ----------
  // top bars become frosted black glass; images ease in as they scroll into view
  function decorate() {
    const W = D.variants[V].w;
    root.querySelectorAll('.text-viewer p').forEach(p => {
      if (p.dataset.rmTrim) return; p.dataset.rmTrim = '1';
      const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [];
      while (tw.nextNode()) nodes.push(tw.currentNode);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const kept = nodes[i].data.replace(/[\s ​‍]+$/, '');
        nodes[i].data = kept; if (kept) break;
      }
    });
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
      t.dataset.rmLink = href; t.setAttribute('role', word === 'contact' ? 'button' : 'link'); t.tabIndex = 0; t.style.cursor = 'pointer';
      const go = () => { if (word === 'contact') openContact(); else location.href = href; };
      t.addEventListener('click', go);
      t.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  }
  // images ease in once they reach the screen; anything already passed (a jump, a fast fling) shows at once
  let pending = [];
  function reveals() {
    pending.forEach(p => p.el.classList.remove('rm-rv')); pending = [];
    if (REDUCED) return;
    const pics = root.querySelectorAll('.content-scroll-wrapper .page-content-container > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > a > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > .rmwidget.video');
    pics.forEach(el => {
      if (el.closest('.rm-intro-orig') || (D.variants[V].intro && el.closest('a.maglink') && parseFloat(el.style.width) >= 200)) return;   // the intro owns the grid
      if (el.classList.contains('rm-in') || !el.offsetWidth) return;     // hidden widgets never need revealing
      el.classList.add('rm-rv'); pending.push({ el, top: el.offsetTop });
    });
    pending.sort((p, q) => p.top - q.top);
    revealTick();
  }
  function revealTick() {
    const atEnd = wrapper.scrollTop >= wrapper.scrollHeight - wrapper.clientHeight - 2;      // the bottom: show everything
    const line = atEnd ? Infinity : wrapper.scrollTop + wrapper.clientHeight * 0.94;
    let i = 0;
    while (i < pending.length && pending[i].top < line) pending[i++].el.classList.add('rm-in');
    if (i) pending = pending.slice(i);
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
    // the project's name, small and quiet, in the middle of the top bar
    const nb = [...root.querySelectorAll('.rm-navbar')].map(el => ({ el, r: el.getBoundingClientRect() })).sort((p, q) => (q.r.bottom - Math.max(0, q.r.top)) - (p.r.bottom - Math.max(0, p.r.top)))[0];
    if (D.name && nb) {
      const f = article.getBoundingClientRect().width / article.clientWidth || 1, a = article.getBoundingClientRect(), r = nb.r;
      const top = Math.max(0, (r.top - a.top) / f), bottom = (r.bottom - a.top) / f;
      if (bottom - top > 12) {
        const nm = document.createElement('div'); nm.className = 'rm-navtitle'; nm.innerHTML = '<span></span>'; nm.firstChild.textContent = D.name;
        Object.assign(nm.style, { top: top + 'px', height: (bottom - top) + 'px' });
        article.appendChild(nm); progBits.push(nm);
      }
    }
  }
  function aidsUpdate() {
    if (!progBits.length) return;
    const [bar, up] = progBits, max = wrapper.scrollHeight - wrapper.clientHeight;
    bar.firstChild.style.transform = `scaleX(${max > 0 ? wrapper.scrollTop / max : 0})`;
    up.classList.toggle('rm-on', wrapper.scrollTop > wrapper.clientHeight * 2.5);
    // rise above the footer band once it scrolls into view (so it never sits on her name)
    const foot = root.querySelector('.rmwidget[data-id$="df3625"], .rmwidget[data-id$="574b45"]');
    if (foot) {
      const a = article.getBoundingClientRect(), f = a.height / article.clientHeight || 1;
      const over = Math.max(0, (a.bottom - foot.getBoundingClientRect().top) / f) * zoom;    // screen px of footer showing
      up.style.bottom = (22 + over) + 'px';
    }
  }

  // ---------- phone menu (Dev, 22 Nov: the solid purple panel "looks very ew") ----------
  // Readymag's hamburger, cross and panel give way to a full-screen frosted-black menu with large type. Same
  // destinations as hers (About, Contact), plus Work, which jumps to the landing page's work grid.
  const MENU = { burger: 'f90e8a', cross: 'e9e29c', panel: 'e6ec15', links: 'cd0e1d' };
  // her own destinations, used where a page lacks the Readymag menu or nav links (page 9 on the phone, About/Contact
  // as plain text on most project pages on the laptop; the same on her live Readymag)
  const SITE = { about: 10, contact: 'mailto:diyakamra1019@gmail.com', linkedin: 'https://www.linkedin.com/in/diyakamra/', email: 'mailto:diyakamra1019@gmail.com', work: 583,
                 cv: null };   // cv: '/diya-kamra-cv.pdf' once her PDF is in site/ (adds a CV button to the contact panel and About)

  // ---------- contact panel (26 Nov) ----------
  // Every "Contact" (laptop top bar, phone menu, landing) opened LinkedIn on some pages and email on others. One small
  // panel now: her address (tap to copy, or write to her), LinkedIn in a new tab, and her CV when there is one.
  let contactEl = null;
  function contactPanel() {
    if (contactEl) return contactEl;
    const addr = SITE.email.replace(/^mailto:/, '');
    const el = document.createElement('div'); el.className = 'rm-contact'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Contact Diya');
    el.innerHTML = `<div class="rm-contact-card"><button type="button" class="rm-contact-x" aria-label="Close"><span></span><span></span></button>
      <p class="rm-contact-k">Say hello</p><a class="rm-contact-mail" href="${SITE.email}"></a>
      <div class="rm-contact-row"><button type="button" class="rm-contact-copy">Copy email</button><a class="rm-contact-btn" href="${SITE.email}">Write to Diya</a></div>
      <div class="rm-contact-row rm-contact-more"><a href="${SITE.linkedin}" target="_blank" rel="noopener">LinkedIn ↗</a>${SITE.cv ? `<a href="${SITE.cv}" target="_blank" rel="noopener">CV ↓</a>` : ''}</div></div>`;
    el.querySelector('.rm-contact-mail').textContent = addr;
    const copy = el.querySelector('.rm-contact-copy');
    copy.addEventListener('click', () => {
      const done = () => { copy.textContent = 'Copied'; copy.classList.add('rm-done'); setTimeout(() => { copy.textContent = 'Copy email'; copy.classList.remove('rm-done'); }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(addr).then(done, () => location.href = SITE.email);
      else location.href = SITE.email;
    });
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.rm-contact-x')) closeContact(); });
    document.body.appendChild(el); contactEl = el;
    return el;
  }
  let contactFrom = null;
  function openContact() {
    const el = contactPanel(); contactFrom = document.activeElement; el.style.zoom = String(1 / zoom);   // sized in screen px
    html.classList.remove('rm-menu-open');
    requestAnimationFrame(() => { html.classList.add('rm-contact-open'); el.querySelector('.rm-contact-copy').focus({ preventScroll: true }); });
  }
  function closeContact() { if (!html.classList.contains('rm-contact-open')) return; html.classList.remove('rm-contact-open'); if (contactFrom && contactFrom.focus) contactFrom.focus({ preventScroll: true }); }
  // her laptop nav words are not links: a clear shape on top of each word carries the link (LinkedIn, for "Contact"),
  // so look at what is under the pointer, not only at the link's own text
  const CONTACT_RE = /^contact$/i;
  const isContact = (a, e) => a && (CONTACT_RE.test(a.textContent.replace(/^\s*\d+/, '').trim()) ||
    (/linkedin\.com/.test(a.getAttribute('href') || '') && !a.textContent.trim() && document.elementsFromPoint(e.clientX, e.clientY)
      .some(el => el.matches && el.matches('.rmwidget.widget-text-v3') && CONTACT_RE.test(el.textContent.trim()))));
  addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a'); if (!isContact(a, e)) return;
    e.preventDefault(); e.stopPropagation(); openContact();
  }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeContact(); });
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
                   ...(own.length ? own : [{ label: 'About', href: url(SITE.about) }, { label: 'Contact', href: SITE.contact }])].map(it => /^contact$/i.test(it.label) ? { ...it, href: SITE.contact } : it);
    const mail = root.querySelector('a[href^="mailto:"]') || { getAttribute: () => SITE.email };
    const li = { getAttribute: () => SITE.linkedin };
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
  // Side arrows go through the work in the grid's order (landing grid, then About), not by page number (26 Nov).
  // They no longer sit over her artwork the whole time: on a laptop one shows when the pointer comes near its edge,
  // and both show near the end of a page (on the phone only there). Keyboard focus always shows them.
  const SEQ = [1, 9, 2, 3, 4, 5, 6, 7, 8, 10];
  let arrowWrap = null;
  function arrows() {
    document.querySelectorAll('.rm-arrows').forEach(x => x.remove()); arrowWrap = null;
    const show = (V === 'desk' ? D.arrows : D.phoneArrows) && D.num > 1;   // the landing page needs no project arrows
    if (!show) return;
    const wrap = document.createElement('div'); wrap.className = 'rm-arrows';
    const mk = (dir, n) => {
      const a = document.createElement('a'); a.className = 'rm-arrow ' + dir; a.href = n === 1 ? url(1) + '#y' + SITE.work : url(n);
      a.setAttribute('aria-label', n === 1 ? 'All work' : dir === 'left' ? 'Previous project' : 'Next project');
      a.innerHTML = `<svg viewBox="0 0 18 34"><polyline points="${dir === 'left' ? '17,1 1,17 17,33' : '1,1 17,17 1,33'}"/></svg>`;
      wrap.appendChild(a);
    };
    const i = SEQ.indexOf(D.num);
    if (i > 0) mk('left', SEQ[i - 1]);
    if (i >= 0 && i < SEQ.length - 1) mk('right', SEQ[i + 1]);
    article.appendChild(wrap);
    wrap.style.zoom = 1 / zoom;
    arrowWrap = wrap; arrowsUpdate();
  }
  function arrowsUpdate() {
    if (!arrowWrap) return;
    const end = wrapper.scrollTop + wrapper.clientHeight > wrapper.scrollHeight - wrapper.clientHeight * 1.1;
    arrowWrap.classList.toggle('rm-at-end', end);
  }
  if (matchMedia('(hover: hover)').matches) addEventListener('pointermove', e => {
    if (!arrowWrap || e.pointerType === 'touch') return;
    arrowWrap.classList.toggle('rm-near-left', e.clientX < 150);
    arrowWrap.classList.toggle('rm-near-right', e.clientX > innerWidth - 150);
  }, { passive: true });
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
    if (step !== undefined) { e.preventDefault(); if (!scrollHeld) wrapper.scrollTop += step; }
    if (scrollHeld) return;
    if (e.key === 'Home') wrapper.scrollTop = 0;
    if (e.key === 'End') wrapper.scrollTop = wrapper.scrollHeight;
  });
  // Pinned (fixed) layers sit outside the scroller. Safari/Firefox don't hand their wheel events to it,
  // so forward them (the live viewer does the same with its own wheel handling).
  addEventListener('wheel', e => {
    if (!wrapper || e.ctrlKey || html.classList.contains('rm-menu-open')) return;      // ctrl = pinch zoom
    if (scrollHeld) { e.preventDefault(); return; }                                    // the intro is mid-move
    if (wrapper.contains(e.target)) return;                                            // native scroll inside
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const dy = (e.deltaY * unit) / zoom;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) wrapper.scrollTop += dy;   // touchpads send many small steps: follow them
    else wrapper.scrollBy({ top: dy, behavior: REDUCED ? 'auto' : 'smooth' });  // a mouse notch glides
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

  // ---------- readable text (Dev, 26 Nov: the About text is "very difficult to read"; "multiple things like this") ----------
  // Her body copy was set small and tight: ~9 px on a phone, lines 1.1 apart. Every long text block gets a reading size
  // and line spacing, a short opening line ("Hi, I'm Diya.") becomes a headline, and paragraphs get air between them.
  // A block that grows pushes down only what sits below it in its own column (anything it overlaps sideways), and that
  // push carries on down the page, so side-by-side layouts keep their shape and the gaps between things stay as she set
  // them. Runs before her animations are set up (they read positions), and again once the font has loaded.
  const READ = { desk: { fs: 11.5, lh: 1.62 }, phone: { fs: 12, lh: 1.58 } };
  function readable() {
    const cfg = READ[V], pc = root.querySelector('.content-scroll-wrapper .page-content-container');
    if (!cfg || !pc || /[?&]noread\b/.test(location.search)) return false;   // ?noread: her original sizes, for comparison
    const items = [...pc.children].map(o => {
      const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget');
      if (!w) return null;
      const posEl = o.style.top ? o : w;                                   // which element carries the position
      if (posEl.dataset.rmTop0 === undefined) posEl.dataset.rmTop0 = parseFloat(posEl.style.top) || 0;
      if (w.dataset.rmH0 === undefined) w.dataset.rmH0 = parseFloat(w.style.height) || parseFloat(o.style.height) || 0;
      const top = +posEl.dataset.rmTop0, h = +w.dataset.rmH0;
      const left = (parseFloat(o.style.left) || 0) + (o === w ? 0 : parseFloat(w.style.left) || 0), width = parseFloat(w.style.width) || 0;
      // a layer that slides along a motion path covers every x it travels through (e.g. a heading resting off-screen
      // to the right that slides in over the text column)
      let dx0 = 0, dx1 = 0;
      const path = (/path\("([^"]*)"\)/.exec(o.dataset.rmPath || o.style.offsetPath || '') || [])[1];
      if (path) { const xs = (path.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter((n, i) => i % 2 === 0); if (xs.length > 1) { dx0 = Math.min(...xs) - xs[0]; dx1 = Math.max(...xs) - xs[0]; } }
      return { o, w, posEl, top, bottom: top + h, left: left + dx0, right: left + width + dx1, grow: 0, shift: 0 };
    }).filter(Boolean);
    let changed = false;
    for (const it of items) {
      if (it.w.classList.contains('rm-inserted')) {                       // e.g. the project facts strip
        it.w.style.height = 'auto'; const need = Math.ceil(it.w.offsetHeight); it.w.style.height = need + 'px';
        it.grow = need; changed = true; continue;
      }
      if (!it.w.matches('.widget-text-v3')) continue;
      const tv = it.w.querySelector('.text-viewer'), text = it.w.textContent.replace(/\s+/g, ' ').trim();
      if (!tv || text.length < 90) continue;
      const spans = [...tv.querySelectorAll('span')], ps = [...tv.querySelectorAll('p')];
      spans.forEach(s => { if (s.dataset.rmFs0 === undefined) s.dataset.rmFs0 = parseFloat(s.style.fontSize) || parseFloat(getComputedStyle(s).fontSize); });
      const body = spans.filter(s => s.textContent.trim().length > 20).map(s => +s.dataset.rmFs0);
      const cur = body.length ? Math.max(...body) : 0;
      if (!cur) continue;
      if (it.w.dataset.rmNat0 === undefined) { const h0 = it.w.style.height; it.w.style.height = 'auto'; it.w.dataset.rmNat0 = tv.offsetHeight; it.w.style.height = h0; }
      it.nat0 = +it.w.dataset.rmNat0 || 1;                 // where her lines actually ended (her boxes run taller)
      const f = Math.max(1, cfg.fs / cur);
      const real = ps.filter(p => p.textContent.replace(/[\s​-‍﻿]/g, '').length);
      const lead = real.length > 2 && real[0].textContent.trim().length < 30 ? real[0] : null;   // "Hi, I'm Diya."
      spans.forEach(s => {
        const k = lead && lead.contains(s) ? 1.9 : 1;
        s.style.fontSize = (+s.dataset.rmFs0 * f * k).toFixed(2) + 'px';
        if (/'wght' 3\d\d/.test(s.style.fontVariationSettings)) s.style.fontVariationSettings = lead && lead.contains(s) ? "'wght' 460" : "'wght' 360";
      });
      ps.forEach(p => {
        const isReal = real.includes(p), size = cur * f * (p === lead ? 1.9 : 1);
        p.style.fontSize = size.toFixed(2) + 'px';
        p.style.lineHeight = isReal ? (size * (p === lead ? 1.2 : cfg.lh)).toFixed(2) + 'px' : (cur * f * 0.5).toFixed(2) + 'px';
        p.style.marginBottom = isReal && p !== real[real.length - 1] ? (cur * f * (p === lead ? 0.5 : 0.75)).toFixed(2) + 'px' : '0px';
      });
      it.w.classList.add('rm-read');
      // her body greys go as dark as rgb(108,108,108) on near-black (3.6:1): lift neutral mid-greys toward white,
      // keeping their order (bold stays brighter), unless the block sits on a picture or shape (a light panel)
      const onLayer = items.some(o => o !== it && !o.w.matches('.widget-text-v3') && o.left <= it.left + 4 && o.right >= it.right - 4 && o.top <= it.top + 4 && o.bottom >= it.bottom - 4);
      if (!onLayer) spans.forEach(sp => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(sp.dataset.rmC0 !== undefined ? sp.dataset.rmC0 : sp.style.color || ''); if (!m) return;   // from her colour, every run
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 14 || r < 80 || r >= 200) return;     // only neutral mid-greys
        const lift = v => Math.round(255 - (255 - v) * 0.6);
        if (sp.dataset.rmC0 === undefined) sp.dataset.rmC0 = sp.style.color;
        sp.style.color = `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
      });
      const hOld = it.bottom - it.top;
      it.w.style.height = 'auto';
      const need = Math.ceil(tv.offsetHeight);
      it.w.style.height = Math.max(hOld, need) + 'px';
      if (it.o !== it.w && it.o.style.height) it.o.style.height = Math.max(hOld, need) + 'px';
      it.grow = Math.max(0, need - hOld); it.nat1 = need; changed = changed || it.grow > 0;
    }
    // push things down the page, column by column
    items.sort((a, b) => a.top - b.top);
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      for (let j = 0; j < i; j++) {
        const a = items[j];
        // below = starts in a's lower half or later (her boxes often overlap a little), and overlaps it sideways
        // below = starts in a's lower half or later (her boxes often overlap a little), and overlaps it sideways; a picture
        // (a sparkle, a doodle) that starts anywhere inside a growing text block moves down with the text it decorates
        const side = a.right > e.left + 2 && e.right > a.left + 2;
        if (side && a.nat1 && !e.w.matches('.widget-text-v3') && e.top > a.top + 2 && e.top < a.bottom) {
          // a picture beside or in a growing text block: past her last line it keeps its gap under the text;
          // among the lines it keeps its place along them
          const c0 = a.top + a.nat0, c1 = a.top + a.nat1;
          e.shift = Math.max(e.shift, a.shift + (e.top >= c0 - 4 ? Math.max(0, c1 - c0) : (e.top - a.top) * (a.nat1 / a.nat0 - 1)));
        } else if (side && (e.top > a.top + (a.bottom - a.top) / 2 || (a.bottom === a.top && e.top >= a.top - 1))) e.shift = Math.max(e.shift, a.shift + a.grow);   // an inserted strip pushes what starts right at it
        // anything sitting on another layer (footer words on the footer band, a caption on a picture) moves with it
        else if (e.top >= a.top - 2 && e.bottom <= a.bottom + 2 && e.left >= a.left - 2 && e.right <= a.right + 2) e.shift = Math.max(e.shift, a.shift);
      }
      e.posEl.style.top = (e.top + e.shift) + 'px';
    }
    if (bounds.dataset.rmH0 === undefined) bounds.dataset.rmH0 = parseFloat(bounds.style.height) || 0;
    const h0 = +bounds.dataset.rmH0, last = items.filter(e => e.bottom >= h0 - 40);
    const extra = Math.max(0, ...(last.length ? last : items).map(e => e.shift + e.grow));
    bounds.style.height = (h0 + extra) + 'px';
    return changed;
  }

  // ---------- project facts (26 Nov): who it was for, the context, when, what she made: from her CV ----------
  // A slim strip under the hero picture on the projects her CV covers. Inserted as a zero-height layer that
  // readable() treats as growing, so everything under it moves down to make room.
  const PROJECT_FACTS = {
    9: [['Client', 'Kinavu Living'], ['Context', 'Internship / Graduation Project'], ['When', 'February–July 2026'], ['Scope', 'Brand imagery, visual assets and brand narrative']],
    2: [['Client', 'Kinavu Living'], ['Project', 'Earth Song, the children’s collection'], ['When', '2026'], ['Scope', 'Logo, standalone and parent-brand lockups, packaging, promotional collaterals']],
    3: [['Client', 'Dimension Decore, interior design studio'], ['Context', 'Freelance'], ['Scope', 'New logo, visual assets, brand narrative and social media']],
  };
  function projectFacts() {
    const facts = PROJECT_FACTS[D.num]; if (!facts) return;
    const pc = root.querySelector('.content-scroll-wrapper .page-content-container'); if (!pc || pc.querySelector(':scope > .rm-pfacts')) return;
    const W = D.variants[V].w;
    const hero = [...pc.querySelectorAll('.rmwidget.widget-picture')].map(w => { const o = w.closest('.animation-container') || w; const top = parseFloat((o.style.top ? o : w).style.top) || 0;
      return { w, top, bottom: top + (parseFloat(w.style.height) || 0), width: parseFloat(w.style.width) || 0 }; })
      .filter(h => h.width >= W * 0.85 && h.top < 420).sort((a, b) => a.top - b.top)[0];
    if (!hero) return;
    const el = document.createElement('div'); el.className = 'rmwidget rm-inserted rm-pfacts';
    el.innerHTML = '<dl>' + facts.map(([k, v]) => `<div><dt>${k}</dt><dd></dd></div>`).join('') + '</dl>';
    el.querySelectorAll('dd').forEach((dd, i) => { dd.textContent = facts[i][1]; });
    const side = V === 'phone' ? 22 : 89;
    // under a banner-like hero; above a tall one (Dimension Decore opens with a stack of tall slides)
    const at = hero.bottom - hero.top > W * 0.8 ? Math.max(0, hero.top - 2) : hero.bottom;
    Object.assign(el.style, { left: side + 'px', top: at + 'px', width: (W - side * 2) + 'px', height: '0px' });
    pc.appendChild(el);
  }

  // ---------- footer (Dev, 26 Nov: "the bottom one doesn't look nice") ----------
  // Her footer was three small words on a purple strip under a dead gap. Every page now closes with a proper footer:
  // her name and what she does, then Email and LinkedIn as real buttons (side by side on a laptop, stacked on the
  // phone), on her purple, a short step under the last piece of work. Her strip and words stay in the page, hidden.
  const FOOT_STRIP = { desk: 'df3625', phone: '574b45' };
  function footer() {
    const pc = root.querySelector('.content-scroll-wrapper .page-content-container');
    const band = pc && pc.querySelector(`.rmwidget.widget-shape[data-id$="${FOOT_STRIP[V]}"]`);
    if (!band) return;
    const outerOf = el => { let o = el; while (o.parentElement && o.parentElement !== pc) o = o.parentElement; return o; };
    const topOf = o => { const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget'); const posEl = o.style.top ? o : w; return posEl ? parseFloat(posEl.style.top) || 0 : 0; };
    const hOf = o => { const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget'); return w ? parseFloat(w.style.height) || 0 : 0; };
    const bandO = outerOf(band), bandTop = topOf(bandO);
    let purple = getComputedStyle(band).backgroundColor;
    if (!purple || purple === 'rgba(0, 0, 0, 0)') { const sh = band.querySelector('[fill]:not([fill="none"])'); purple = sh ? sh.getAttribute('fill') : 'rgb(126, 87, 182)'; }
    const hide = new Set([bandO, ...[...pc.querySelectorAll('.rmwidget.rm-foot')].map(outerOf)]);
    hide.forEach(o => o.classList.add('rm-foot-hidden'));
    let f = pc.querySelector(':scope > .rm-footer');
    if (!f) {
      f = document.createElement('footer'); f.className = 'rm-footer';
      f.innerHTML = `<div class="rm-footer-in"><div class="rm-footer-id"><strong>Diya Kamra</strong><span>Graphic &amp; Communication Designer</span><em>National Institute of Design (NID) &middot; 2026</em></div>
        <div class="rm-footer-links"><a class="rm-footer-btn rm-solid" href="${SITE.email}">Email</a><a class="rm-footer-btn" href="${SITE.linkedin}" target="_blank" rel="noopener">LinkedIn ↗</a></div></div>`;
      pc.appendChild(f);
    }
    // snug under the last thing on the page (not counting anything parked below the page's end)
    const H0 = parseFloat(bounds.style.height) || 0;
    let bottom = 0;
    for (const o of pc.children) {
      if (o === f || hide.has(o)) continue;
      const t = topOf(o); if (t > H0 - 2) continue;
      bottom = Math.max(bottom, t + hOf(o));
    }
    const top = Math.min(bandTop, bottom + (V === 'phone' ? 30 : 44));
    const W = D.variants[V].w;
    Object.assign(f.style, { top: top + 'px', left: '0px', width: W + 'px', background: purple });
    const h = f.offsetHeight;
    bounds.style.height = (top + h) + 'px';
  }

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
    projectFacts(); readable(); footer();
    scalePaths(motionK); setupAnimations(); videos(); decorate(); phoneMenu();
    // the reading sizes are measured with her font: once it has loaded, measure again and put everything back in step
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (V !== v) return; const grew = readable(); footer(); if (grew) { setupAnimations(); reveals(); } onScroll(); });
  }
  // nav words come in pairs: a white word that fades on hover over a purple twin. Her twins' boxes are a little
  // different in size, so the centred letters sit ~1px apart and a purple fringe shows at rest: put each twin's
  // letters exactly under the white word's. Runs after every layout (and after any motion-path correction).
  function alignNavTwins() {
    const hover = new Set(D.variants[V].anims.filter(r => r.anims.some(a => a.type === 'hover')).map(r => r.id));
    const glyphs = el => { const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let a = null, b = null;
      while (tw.nextNode()) if (tw.currentNode.data.trim()) { a = a || tw.currentNode; b = tw.currentNode; }
      if (!a) return null; const r = document.createRange(); r.setStart(a, a.data.search(/\S/)); r.setEnd(b, b.data.trimEnd().length); return r.getBoundingClientRect(); };
    const fz = bounds.getBoundingClientRect().width / bounds.offsetWidth || 1;     // screen px per design px
    const words = [...root.querySelectorAll('.fixed-position-container .rmwidget.widget-text-v3, .fixed-position-container-top .rmwidget.widget-text-v3')];
    words.forEach(el => { if (el.dataset.rmAligned) el.style.translate = ''; });
    const info = words.map(el => ({ el, txt: el.textContent.trim().toLowerCase(), white: hover.has(el.dataset.id), g: glyphs(el) })).filter(w => w.txt && w.g && w.g.width);
    info.filter(w => w.white).forEach(w => {
      const twin = info.find(u => !u.white && u.txt === w.txt && Math.abs(u.g.left - w.g.left) < 8 * fz && Math.abs(u.g.top - w.g.top) < 8 * fz);
      if (!twin) return;
      twin.el.dataset.rmAligned = '1';
      twin.el.style.translate = `${(w.g.left - twin.g.left) / fz}px ${(w.g.top - twin.g.top) / fz}px`;
    });
  }

  function layout() {
    const v = innerWidth < PHONE_MAX ? 'phone' : 'desk';
    zoom = Math.min(innerWidth, SCALE_MAX) / D.variants[v].w;
    html.style.zoom = zoom; html.style.setProperty('--rmz', zoom);   // --rmz: lets CSS size things in screen px
    if (v !== V) activate(v);
    const aw = innerWidth / zoom, ah = innerHeight / zoom;
    article.style.width = aw + 'px'; article.style.height = ah + 'px';
    bounds.style.minHeight = ah + 'px';
    const k = probeMotion();                                  // 1 except in engines that zoom motion paths twice
    if (Math.abs(k - motionK) > 0.002) { motionK = k; scalePaths(k); setupAnimations(); }
    arrows(); pageAids(); if (!intro || intro.variant !== V) setupIntro(); else intro.measure(); reveals(); alignNavTwins(); onScroll();
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
  if (jump) { wrapper.scrollTop = curY = intro ? intro.workTop(+jump[1]) : +jump[1]; history.replaceState(null, '', location.pathname + location.search); if (intro) intro.sync(); onScroll(); }
  window.__rm = { get zoom() { return zoom; }, get variant() { return V; }, get wrapper() { return wrapper; } };
})();
