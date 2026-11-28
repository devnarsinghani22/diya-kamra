(() => {
  'use strict';
  const D = window.RM;
  const html = document.documentElement;
  const PHONE_MAX = 640;
  const SCALE_MAX = 3600;
  const K = 1;
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
  let curY = 0;
  let scrollHeld = false;
  const wid = id => root.querySelector(`.rmwidget[data-id="${id}"]`);
  const clamp01 = t => Math.min(1, Math.max(0, t));
  const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const LOAD_DELAY = 700;
  const HINT_IDS = ['6afe2ac4d5e1c0276569f18f', '6b02d66c7bf161fe4b5cb7ae', '6b02d6bfdc99aa72f2f5f195'];
  for (const vv of Object.values(D.variants)) for (const r of vv.anims || []) if (HINT_IDS.includes(r.id))
    for (const a of r.anims) if (a.type === 'load') for (const st of a.steps) { if (st.use_opacity) { st.from_opacity = 35; st.opacity = 95; } }
  function containersOf(el) {
    const out = []; let p = el.parentElement;
    while (p && (p.classList.contains('animation-container') || p.tagName === 'A')) {
      if (p.tagName !== 'A') out.unshift(p);
      p = p.parentElement;
    }
    return out;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function pathLens(box) {
    const m = /path\("([^"]*)"\)/.exec(box.style.offsetPath || '');
    if (!m) return [];
    return m[1].split(/(?=M)/).map(seg => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', seg); return p.getTotalLength(); });
  }
  function buildScroll(rec, a, box, top) {
    const st0 = a.steps[0];
    const segs = pathLens(box);
    let at = 0, mi = 0;
    const y = Number.isFinite(top) ? top : rec.y;
    const steps = a.steps.map(st => {
      const dataLen = st.use_move ? Math.hypot(st.dx || 0, st.dy || 0) : 0;
      const fromPath = st.use_move && segs[mi] !== undefined;
      const len = st.use_move ? (fromPath ? segs[mi++] * motionK : dataLen) : 0;
      const fade = (V === 'desk' && rec.fixed) ? 212 : 300;
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
      if (useOp) { box.style.opacity = cur.opacity / 100; box.style.visibility = cur.opacity <= 0.5 ? 'hidden' : ''; }
    };
  }
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
  const hideIfFaded = box => { box.style.visibility = parseFloat(getComputedStyle(box).opacity) <= 0.01 ? 'hidden' : ''; };
  let motionK = 1;
  function probeMotion() {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;offset-path:path("M 105 5");offset-distance:0px;offset-rotate:0deg;visibility:hidden';
    article.appendChild(d);
    const a = article.getBoundingClientRect(), r = d.getBoundingClientRect(), f = a.width / article.clientWidth || 1;
    d.remove();
    const x = (r.left - a.left) / f + 5;
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
    const claimed = new WeakSet();
    for (const rec of recs) {
      const el = byId(rec.id); if (!el) continue;
      const boxes = containersOf(el);
      const top = boxes.length ? parseFloat(boxes[0].style.top) : NaN;
      rec.anims.forEach((a, i) => {
        const box = boxes[i]; if (!box || claimed.has(box)) return;
        claimed.add(box);
        if (box.classList.contains('rm-static')) return;
        box.classList.remove('invisible');
        if (a.type === 'scroll') { const f = buildScroll(rec, a, box, top); f.box = box; scrollAnims.push(f); return; }
        const anim = timeAnim(box, a);
        if (a.type === 'load') { anim.pause(); anim.currentTime = 0; const t = setTimeout(() => anim.play(), LOAD_DELAY); cleanups.push(() => clearTimeout(t), () => anim.cancel()); return; }
        anim.pause(); anim.currentTime = 0;
        const triggers = (a.trigger.length ? a.trigger.map(byId) : [box]).filter(Boolean);
        triggers.push(...root.querySelectorAll(`[data-rm-hover="${rec.id}"]`));
        if (a.type === 'hover') {
          const on = e => { if (e.pointerType === 'touch') return; anim.playbackRate = 1; anim.play(); };
          const off = e => { if (e.pointerType === 'touch') return; anim.playbackRate = -1; anim.play(); };
          triggers.forEach(t => { t.addEventListener('pointerenter', on); t.addEventListener('pointerleave', off);
                                  cleanups.push(() => { t.removeEventListener('pointerenter', on); t.removeEventListener('pointerleave', off); }); });
        } else if (a.type === 'click') {
          let open = false;
          if (triggers.some(t => !box.contains(t))) { hideIfFaded(box); anim.addEventListener('finish', () => hideIfFaded(box)); }
          const tog = () => { open = !open; box.style.visibility = ''; anim.playbackRate = open ? 1 : -1; anim.play(); };
          triggers.forEach(t => { t.style.cursor = 'pointer'; t.addEventListener('click', tog); cleanups.push(() => t.removeEventListener('click', tog)); });
        }
        cleanups.push(() => anim.cancel());
      });
    }
  }
  let ticking = false, last = 0;
  function frame(now) {
    const target = wrapper.scrollTop, dt = Math.min(64, last ? now - last : 16.7); last = now;
    curY += (target - curY) * (REDUCED ? 1 : 1 - Math.pow(0.55, dt / 16.7));
    if (Math.abs(target - curY) < 0.3) curY = target;
    const vh = wrapper.clientHeight;
    for (const f of scrollAnims) f(vh);
    if (intro) intro.onScroll();
    aidsUpdate(); arrowsUpdate(); if (pending.length) revealTick();
    if (curY !== target) requestAnimationFrame(frame); else { ticking = false; last = 0; }
  }
  function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(frame); }
  setInterval(() => {
    if (!root || document.hidden) return;
    root.querySelectorAll('video[data-autoplay]').forEach(v => {
      if (!v.src || !v.paused || v.dataset.userPaused || v.ended && !v.loop) return;
      const r = v.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) { v.muted = true; v.play().catch(() => {}); }
    });
  }, 700);
  let vio = null;
  function videos() {
    if (vio) vio.disconnect();
    document.querySelectorAll('video[data-src]').forEach(v => { if (!root.contains(v) && v.src) v.pause(); });
    vio = new IntersectionObserver(entries => {
      for (const en of entries) {
        const v = en.target;
        if (en.isIntersecting) {
          if (v.dataset.poster && !v.getAttribute('poster')) v.poster = v.dataset.poster;
          if (!v.src) {
            if (v.hasAttribute('data-autoplay')) { v.muted = true; v.autoplay = true; }
            v.src = v.dataset.src; v.preload = 'auto';
          }
          if (v.hasAttribute('data-autoplay') && !v.dataset.userPaused) v.play().catch(() => {});
        } else if (v.src) v.pause();
      }
    }, { root: wrapper, rootMargin: '100% 0px 100% 0px' });
    root.querySelectorAll('video[data-src]').forEach(v => {
      vio.observe(v);
      if (v.dataset.wired) return; v.dataset.wired = '1';
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
  let intro = null;
  const PLANES = [
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
      if (pl.name === 'plants') {
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
    scrollAnims = scrollAnims.filter(f => !(f.box && f.box.closest('.rm-intro-orig')));
    const hint = document.createElement('div'); hint.className = 'rm-intro-hint'; layer.appendChild(hint);
    root.querySelectorAll('.content-scroll-wrapper .page-content-container > .animation-container, .content-scroll-wrapper .page-content-container > .rmwidget').forEach(o => {
      const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget');
      if (!w || w.matches('.widget-picture') || o.classList.contains('rm-intro-orig')) return;
      if ((parseFloat(o.style.top) || 0) < 300) { moved.push([o, o.parentElement, o.nextSibling]); hint.appendChild(o); }
    });
    const veil = document.createElement('div'); veil.className = 'rm-intro-veil'; layer.appendChild(veil);
    const iconsEl = document.createElement('div'); iconsEl.className = 'rm-icons'; layer.appendChild(iconsEl);
    const icons = tiles.map(t => {
      t.img.loading = 'eager';
      const a = document.createElement('a'); a.className = 'rm-icon'; a.href = t.href; a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1;
      a.style.width = t.w + 'px'; a.style.height = t.h + 'px';
      const im = new Image(); im.alt = t.img.alt || ''; im.fetchPriority = 'low'; im.decoding = 'async'; im.src = t.img.getAttribute('src'); a.appendChild(im); iconsEl.appendChild(a); return a;
    });
    if (V === 'phone') article.insertBefore(layer, article.querySelector('.fixed-position-container-top')); else article.appendChild(layer);
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
      const b = Math.min(1.4, Math.max(1, VH / Math.max(1, bottom - Math.max(0, topMin))));
      const [a1, b1, c1, d1] = cfg.screen, L = laptopItem;
      const screen = { x: L._l + a1 * L.w, y: L._t + b1 * L.h, w: (c1 - a1) * L.w, h: (d1 - b1) * L.h };
      Object.assign(shade.style, { left: screen.x + 'px', top: screen.y + 'px', width: screen.w + 'px', height: screen.h + 'px' });
      const Bc = b > 1 ? { x: VW / 2, y: (Math.max(0, topMin) + bottom) / 2 } : { x: 0, y: 0 }, Bo = b > 1 ? { x: VW / 2, y: VH / 2 } : Bc;
      const B = p => ({ x: Bo.x + (p.x - Bc.x) * b, y: Bo.y + (p.y - Bc.y) * b });
      const O = B({ x: screen.x + screen.w / 2, y: screen.y + screen.h / 2 });
      const K = Math.max(VW / (screen.w * b), VH / (screen.h * b)) * 1.06;
      const cols = 4, iw = screen.w * 0.15, gap = (screen.w - cols * iw) / (cols + 1);
      const slots = tiles.map((t, i) => { const h = iw * t.h / t.w, r = Math.floor(i / cols);
        return { x: screen.x + gap + (i % cols) * (iw + gap), y: screen.y + screen.h * 0.11 + r * (h + screen.h * 0.07), w: iw }; });
      G = { VW, VH, b, Bc, Bo, O, K, slots };
    }
    function planeMap(d, e, par) {
      const s = Math.pow(G.K, e * d), t = { x: (G.VW / 2 - G.O.x) * e + par.x, y: (G.VH / 2 - G.O.y) * e + par.y };
      const k = s * G.b;
      return { k, A: { x: G.O.x + t.x + s * (G.Bo.x - G.O.x) - k * G.Bc.x, y: G.O.y + t.y + s * (G.Bo.y - G.O.y) - k * G.Bc.y } };
    }
    let P = 0, ptr = { x: 0, y: 0 }, ptrT = { x: 0, y: 0 }, idle = 0;
    function render() {
      if (!G) return;
      const e = easeIO(clamp01(P / 0.62));
      let lap = null;
      for (const pl of planes) {
        const par = { x: ptr.x * pl.px * 9 * (1 - e), y: ptr.y * pl.px * 6 * (1 - e) };
        const m = planeMap(pl.d, e, par);
        pl.el.style.transform = `translate(${m.A.x}px, ${m.A.y}px) scale(${m.k})`;
        if (pl.d > 1.05) pl.el.style.opacity = 1 - clamp01((m.k - 2.4) / 2.6);
        if (pl.name === 'laptop') lap = m;
      }
      shade.style.opacity = clamp01((P - 0.45) / 0.25);
      veil.style.opacity = clamp01((P - 0.52) / 0.2);
      hint.style.opacity = 1 - clamp01(P * 6);
      const q = easeIO(clamp01((P - 0.55) / 0.4)), st = stFix !== null ? stFix : wrapper.scrollTop;
      icons.forEach((a, i) => {
        const sl = G.slots[i], t = tiles[i];
        const vx = lap.A.x + lap.k * sl.x, vy = lap.A.y + lap.k * sl.y, vw = sl.w * lap.k;
        const x = vx + (t.x - vx) * q, y = vy + (t.y - st - vy) * q, k = (vw + (t.w - vw) * q) / t.w;
        a.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        a.style.borderRadius = (2.5 * (1 - q)) / k + 'px';
      });
      layer.style.opacity = 1 - clamp01((P - 0.9) / 0.1);
      layer.style.visibility = P >= 1 ? 'hidden' : '';
    }
    const END = V === 'phone' ? Math.min(cfg.end, Math.round(tiles[0].y - 62)) : cfg.end, FWD = 1900, BACK = 1500, REV = END - 140;
    let state = 'scene', anim = null, cooldown = 0, dog = 0, stFix = null, settleT = 0;
    const jumpTo = y => { wrapper.scrollTop = y; curY = wrapper.scrollTop; lastY = curY; };
    const hold = on => { scrollHeld = on; wrapper.style.overflowY = on ? 'hidden' : ''; };
    function play(to) {
      if (anim) return;
      state = to ? 'toGrid' : 'toScene';
      const from = P, span = Math.abs(to - from) * (to ? FWD : BACK);
      const t0 = performance.now();
      hold(true);
      if (to && wrapper.scrollTop < END) jumpTo(END);
      stFix = wrapper.scrollTop;
      let atTop = !!to || wrapper.scrollTop <= 2;
      const finish = () => { cancelAnimationFrame(anim); anim = null; clearTimeout(dog); if (!atTop) jumpTo(0); P = to; stFix = null; render(); state = to ? 'grid' : 'scene'; hold(false); cooldown = performance.now() + 600;
        clearTimeout(settleT); settleT = setTimeout(settle, 650); };
      const step = now => {
        P = from + (to - from) * clamp01((now - t0) / Math.max(1, span));
        if (!atTop && P < 0.88) { atTop = true; jumpTo(0); }
        render(); if (P === to) finish(); else anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
      dog = setTimeout(() => { if (anim) finish(); }, span + 1500);
    }
    let lastY = wrapper.scrollTop;
    function settle() {
      if (anim || !G) return;
      const y = wrapper.scrollTop; lastY = y;
      if (state === 'grid' && y < REV) play(0);
    }
    function onScrollIntro() {
      const y = wrapper.scrollTop, dir = y - lastY; lastY = y;
      if (anim || performance.now() < cooldown) return;
      if (state === 'scene' && y > 6 && dir > 0) play(1);
      else if (state === 'grid' && y < REV && (dir < 0 || y < REV / 2)) play(0);
      else if (P < 1) render();
    }
    const onTap = e => { if (state === 'scene' && !anim && !(e.target.closest && e.target.closest('a, button'))) { lastY = wrapper.scrollTop; play(1); } };
    wrapper.addEventListener('click', onTap);
    const onHide = () => { if (document.hidden && anim) { cancelAnimationFrame(anim); anim = null; clearTimeout(dog); P = state === 'toGrid' ? 1 : 0; if (!P && wrapper.scrollTop > 2) jumpTo(0); stFix = null; render(); state = P ? 'grid' : 'scene'; hold(false); } };
    document.addEventListener('visibilitychange', onHide);
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
    if (wrapper.scrollTop >= END - 2) { P = 1; state = 'grid'; }
    render();
    intro = {
      variant: V, onScroll: onScrollIntro, measure() { measure(); render(); },
      images: [...layer.querySelectorAll('.rm-plane img')],
      arrive() { if (P > 0) return; layer.classList.add('rm-arrive'); layer.addEventListener('animationend', () => layer.classList.remove('rm-arrive'), { once: true }); },
      workTop: pos => (pos === cfg.end ? END : pos),
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
    if (D.names) root.querySelectorAll('.content-scroll-wrapper a.maglink > .rmwidget.widget-picture img').forEach(im => {
      const m = /\/(\d+)\/$/.exec(im.closest('a').getAttribute('href') || ''); const name = m && D.names[m[1]];
      if (name && !im.alt) im.alt = name;
    });
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
  let pending = [];
  function reveals() {
    pending.forEach(p => p.el.classList.remove('rm-rv')); pending = [];
    if (REDUCED) return;
    const pics = root.querySelectorAll('.content-scroll-wrapper .page-content-container > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > a > .rmwidget.widget-picture, .content-scroll-wrapper .page-content-container > .rmwidget.video');
    pics.forEach(el => {
      if (el.closest('.rm-intro-orig') || (D.variants[V].intro && el.closest('a.maglink') && parseFloat(el.style.width) >= 200)) return;
      if (el.classList.contains('rm-in') || !el.offsetWidth) return;
      el.classList.add('rm-rv'); pending.push({ el, top: el.offsetTop });
    });
    pending.sort((p, q) => p.top - q.top);
    revealTick();
  }
  function revealTick() {
    const atEnd = wrapper.scrollTop >= wrapper.scrollHeight - wrapper.clientHeight - 2;
    const line = atEnd ? Infinity : wrapper.scrollTop + wrapper.clientHeight * 0.94;
    let i = 0;
    while (i < pending.length && pending[i].top < line) pending[i++].el.classList.add('rm-in');
    if (i) pending = pending.slice(i);
  }
  let progBits = [];
  function pageAids() {
    progBits.forEach(x => x.remove()); progBits = [];
    if (D.num === 1) return;
    const bar = document.createElement('div'); bar.className = 'rm-progress'; bar.innerHTML = '<i></i>';
    const up = document.createElement('button'); up.className = 'rm-totop'; up.type = 'button'; up.setAttribute('aria-label', 'Back to top');
    up.innerHTML = '<svg viewBox="0 0 16 16"><polyline points="3,10 8,5 13,10"/></svg>';
    up.addEventListener('click', () => wrapper.scrollTo({ top: 0, behavior: 'smooth' }));
    article.append(bar, up); progBits = [bar, up];
    bar.style.zoom = up.style.zoom = 1 / zoom;
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
    const footEl = root.querySelector('.rm-footer'), fr = footEl && footEl.getBoundingClientRect();
    up.classList.toggle('rm-on', wrapper.scrollTop > wrapper.clientHeight * 2.5 && !(fr && fr.top < innerHeight - 40));
    const foot = root.querySelector('.rmwidget[data-id$="df3625"], .rmwidget[data-id$="574b45"]');
    if (foot) {
      const a = article.getBoundingClientRect(), f = a.height / article.clientHeight || 1;
      const over = Math.max(0, (a.bottom - foot.getBoundingClientRect().top) / f) * zoom;
      up.style.bottom = (22 + over) + 'px';
    }
  }
  const MENU = { burger: 'f90e8a', cross: 'e9e29c', panel: 'e6ec15', links: 'cd0e1d' };
  const SITE = { about: 10, contact: 'mailto:diyakamra1019@gmail.com', linkedin: 'https://www.linkedin.com/in/diyakamra/', email: 'mailto:diyakamra1019@gmail.com', work: 583,
                 cv: null };
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
    location.href = SITE.email; return;
    const el = contactPanel(); contactFrom = document.activeElement; el.style.zoom = String(1 / zoom);
    html.classList.remove('rm-menu-open');
    requestAnimationFrame(() => { html.classList.add('rm-contact-open'); el.querySelector('.rm-contact-copy').focus({ preventScroll: true }); });
  }
  function closeContact() { if (!html.classList.contains('rm-contact-open')) return; html.classList.remove('rm-contact-open'); if (contactFrom && contactFrom.focus) contactFrom.focus({ preventScroll: true }); }
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
      a.innerHTML = '<span></span>'; a.lastChild.textContent = it.label;
      a.addEventListener('click', e => {
        if (it.work) { e.preventDefault(); wrapper.scrollTo({ top: intro ? intro.workTop(workPos) : workPos, behavior: 'smooth' }); }
        closeMenu(); btn.setAttribute('aria-expanded', 'false');
      });
      liEl.appendChild(a); ul.appendChild(liEl);
    });
    const foot = document.createElement('div'); foot.className = 'rm-menu-foot';
    if (mail) { const a = document.createElement('a'); a.href = mail.getAttribute('href'); a.textContent = mail.getAttribute('href').replace(/^mailto:/, ''); foot.appendChild(a); }
    if (li) { const a = document.createElement('a'); a.href = li.getAttribute('href'); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'LinkedIn'; foot.appendChild(a); }
    nav.append(ul, foot);
    btn.addEventListener('click', () => { const open = html.classList.toggle('rm-menu-open'); btn.setAttribute('aria-expanded', String(open)); });
    article.append(nav, btn); menuBits = [nav, btn];
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  const BASE = D.base || '';
  const url = n => BASE + (n === 1 ? '/' : `/${n}/`);
  const SEQ = [1, 9, 2, 3, 4, 5, 6, 7, 8, 10];
  let arrowWrap = null;
  function arrows() {
    document.querySelectorAll('.rm-arrows').forEach(x => x.remove()); arrowWrap = null;
    const show = (V === 'desk' ? D.arrows : D.phoneArrows) && D.num > 1;
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
    const page = wrapper.clientHeight * 0.9;
    const step = { ArrowDown: 60, ArrowUp: -60, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
    if (step !== undefined) { e.preventDefault(); if (!scrollHeld) wrapper.scrollTop += step; }
    if (scrollHeld) return;
    if (e.key === 'Home') wrapper.scrollTop = 0;
    if (e.key === 'End') wrapper.scrollTop = wrapper.scrollHeight;
  });
  addEventListener('wheel', e => {
    if (!wrapper || e.ctrlKey || html.classList.contains('rm-menu-open')) return;
    if (scrollHeld) { e.preventDefault(); return; }
    if (wrapper.contains(e.target)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const dy = (e.deltaY * unit) / zoom;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) wrapper.scrollTop += dy;
    else wrapper.scrollBy({ top: dy, behavior: REDUCED ? 'auto' : 'smooth' });
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
  const READ = { desk: { fs: 11.5, lh: 1.62 }, phone: { fs: 12, lh: 1.58 } };
  function readable() {
    const cfg = READ[V], pc = root.querySelector('.content-scroll-wrapper .page-content-container');
    if (!cfg || !pc || /[?&]noread\b/.test(location.search)) return false;
    const items = [...pc.children].map(o => {
      const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget');
      if (!w) return null;
      const posEl = o.style.top ? o : w;
      if (posEl.dataset.rmTop0 === undefined) posEl.dataset.rmTop0 = parseFloat(posEl.style.top) || 0;
      if (w.dataset.rmH0 === undefined) w.dataset.rmH0 = parseFloat(w.style.height) || parseFloat(o.style.height) || 0;
      const top = +posEl.dataset.rmTop0, h = +w.dataset.rmH0;
      const left = (parseFloat(o.style.left) || 0) + (o === w ? 0 : parseFloat(w.style.left) || 0), width = parseFloat(w.style.width) || 0;
      let dx0 = 0, dx1 = 0;
      const path = (/path\("([^"]*)"\)/.exec(o.dataset.rmPath || o.style.offsetPath || '') || [])[1];
      if (path) { const xs = (path.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter((n, i) => i % 2 === 0); if (xs.length > 1) { dx0 = Math.min(...xs) - xs[0]; dx1 = Math.max(...xs) - xs[0]; } }
      return { o, w, posEl, top, bottom: top + h, left: left + dx0, right: left + width + dx1, grow: 0, shift: 0 };
    }).filter(Boolean);
    let changed = false;
    for (const it of items) {
      if (it.w.classList.contains('rm-inserted')) {
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
      it.nat0 = +it.w.dataset.rmNat0 || 1;
      const f = Math.max(1, cfg.fs / cur);
      const real = ps.filter(p => p.textContent.replace(/[\s​-‍﻿]/g, '').length);
      const lead = real.length > 2 && real[0].textContent.trim().length < 30 ? real[0] : null;
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
      const onLayer = items.some(o => o !== it && !o.w.matches('.widget-text-v3') && o.left <= it.left + 4 && o.right >= it.right - 4 && o.top <= it.top + 4 && o.bottom >= it.bottom - 4);
      if (!onLayer) spans.forEach(sp => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(sp.dataset.rmC0 !== undefined ? sp.dataset.rmC0 : sp.style.color || ''); if (!m) return;
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 14 || r < 80 || r >= 200) return;
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
    items.sort((a, b) => a.top - b.top);
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      for (let j = 0; j < i; j++) {
        const a = items[j];
        const side = a.right > e.left + 2 && e.right > a.left + 2;
        if (side && a.nat1 && !e.w.matches('.widget-text-v3') && e.top > a.top + 2 && e.top < a.bottom) {
          const c0 = a.top + a.nat0, c1 = a.top + a.nat1;
          e.shift = Math.max(e.shift, a.shift + (e.top >= c0 - 4 ? Math.max(0, c1 - c0) : (e.top - a.top) * (a.nat1 / a.nat0 - 1)));
        } else if (side && (e.top > a.top + (a.bottom - a.top) / 2 || (a.bottom === a.top && e.top >= a.top - 1))) e.shift = Math.max(e.shift, a.shift + a.grow);
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
    const at = hero.bottom - hero.top > W * 0.8 ? Math.max(0, hero.top - 2) : hero.bottom;
    Object.assign(el.style, { left: side + 'px', top: at + 'px', width: (W - side * 2) + 'px', height: '0px' });
    pc.appendChild(el);
  }
  const STILL = { 10: { phone: ['05de41', '1473e9'] } };
  function stillLayers() {
    const ids = (STILL[D.num] || {})[V]; if (!ids) return;
    ids.forEach(suf => {
      const w = root.querySelector(`.rmwidget[data-id$="${suf}"]`); if (!w) return;
      containersOf(w).forEach(c => { c.classList.add('rm-static'); c.classList.remove('invisible'); c.style.offsetDistance = '100%'; c.style.opacity = ''; });
    });
  }
  function aboutColumns() {
    if (D.num !== SITE.about || V !== 'desk') return;
    const pc = root.querySelector('.content-scroll-wrapper .page-content-container');
    const facts = root.querySelector('.content-scroll-wrapper .rm-facts'); if (!pc || !facts || facts.closest('.rm-facts-col')) return;
    const bio = facts.closest('.rmwidget'); const textLeft = parseFloat(bio.style.left) || 533;
    let charBottom = 0;
    pc.querySelectorAll('.rmwidget.widget-picture').forEach(w => { const o = w.closest('.animation-container') || w; const top = parseFloat((o.style.top ? o : w).style.top) || 0;
      const left = parseFloat(o.style.left) || 0; if (left < textLeft && top < 300) charBottom = Math.max(charBottom, top + (parseFloat(w.style.height) || 0)); });
    const col = document.createElement('div'); col.className = 'rmwidget rm-inserted rm-facts-col';
    const left = 96, width = textLeft - left - 70;
    Object.assign(col.style, { left: left + 'px', top: (charBottom + 34) + 'px', width: width + 'px', height: '0px' });
    col.appendChild(facts); pc.appendChild(col);
  }
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
      f.innerHTML = `<div class="rm-footer-in"><div class="rm-footer-id"><strong>Diya Kamra</strong><span>Graphic &amp; Communication Designer, National Institute of Design</span></div>
        <div class="rm-footer-links"><a href="${SITE.email}">Email</a><a href="${SITE.linkedin}" target="_blank" rel="noopener">LinkedIn</a></div></div>`;
      pc.appendChild(f);
    }
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
  function activate(v) {
    V = v; html.dataset.v = v;
    root = document.getElementById('v-' + v);
    if (!root.firstElementChild) { const t = document.getElementById('t-' + v); if (t) root.appendChild(t.content.cloneNode(true)); }
    article = root.querySelector('article.page');
    wrapper = article.querySelector('.content-scroll-wrapper');
    bounds = article.querySelector('.content-bounds');
    document.querySelectorAll('.content-scroll-wrapper').forEach(w => w.removeEventListener('scroll', onScroll));
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    curY = wrapper.scrollTop;
    projectFacts(); aboutColumns(); readable(); footer(); stillLayers();
    scalePaths(motionK); setupAnimations(); videos(); decorate(); phoneMenu();
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (V !== v) return; const grew = readable(); footer(); if (grew) { setupAnimations(); reveals(); } onScroll(); });
  }
  function alignNavTwins() {
    const hover = new Set(D.variants[V].anims.filter(r => r.anims.some(a => a.type === 'hover')).map(r => r.id));
    const glyphs = el => { const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let a = null, b = null;
      while (tw.nextNode()) if (tw.currentNode.data.trim()) { a = a || tw.currentNode; b = tw.currentNode; }
      if (!a) return null; const r = document.createRange(); r.setStart(a, a.data.search(/\S/)); r.setEnd(b, b.data.trimEnd().length); return r.getBoundingClientRect(); };
    const fz = bounds.getBoundingClientRect().width / bounds.offsetWidth || 1;
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
    html.style.zoom = zoom; html.style.setProperty('--rmz', zoom);
    if (v !== V) activate(v);
    const aw = innerWidth / zoom, ah = innerHeight / zoom;
    article.style.width = aw + 'px'; article.style.height = ah + 'px';
    bounds.style.minHeight = ah + 'px';
    const k = probeMotion();
    if (Math.abs(k - motionK) > 0.002) { motionK = k; scalePaths(k); setupAnimations(); }
    arrows(); pageAids(); if (!intro || intro.variant !== V) setupIntro(); else intro.measure(); reveals(); alignNavTwins(); onScroll();
  }
  addEventListener('resize', layout);
  layout();
  (function loader() {
    const el = document.getElementById('rm-loader');
    if (!el) return;
    if (html.classList.contains('rm-noload')) { el.remove(); return; }
    el.style.zoom = 1 / zoom;
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
      }, 180);
    };
    (function tick() {
      if (ended) return;
      const frac = list.length ? list.filter(im => im.complete).length / list.length : 1, t = performance.now() - t0;
      shown += (Math.max(frac, Math.min(0.9, t / 4000)) - shown) * 0.15;
      bar.style.setProperty('--p', shown.toFixed(3));
      if ((frac >= 1 && t > 450) || t > 5000) finish(); else requestAnimationFrame(tick);
    })();
    setTimeout(finish, 5600);
  })();
  const jump = /^#y(\d+)$/.exec(location.hash);
  if (jump) { wrapper.scrollTop = curY = intro ? intro.workTop(+jump[1]) : +jump[1]; history.replaceState(null, '', location.pathname + location.search); if (intro) intro.sync(); onScroll(); }
  window.__rm = { get zoom() { return zoom; }, get variant() { return V; }, get wrapper() { return wrapper; } };
})();
