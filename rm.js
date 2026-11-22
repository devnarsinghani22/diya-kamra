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
    return vh => {
      const sp = st0.start_point || 'bottom', off = st0.start_offset || 0;
      const base = rec.fixed ? 0 : Math.max(0, (sp === 'top' ? y : sp === 'center' ? y - vh / 2 : y - vh));
      const s = wrapper.scrollTop - base - off;
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
        box.classList.remove('invisible');           // opacity is driven by the animation from here on
        if (a.type === 'scroll') { scrollAnims.push(buildScroll(rec, a, box, top)); return; }
        const anim = timeAnim(box, a);
        if (a.type === 'load') { anim.play(); return; }
        anim.pause(); anim.currentTime = 0;
        const triggers = (a.trigger.length ? a.trigger.map(byId) : [box]).filter(Boolean);   // no trigger = the whole group
        if (a.type === 'hover') {
          const on = () => { anim.playbackRate = 1; anim.play(); }, off = () => { anim.playbackRate = -1; anim.play(); };
          triggers.forEach(t => { t.addEventListener('pointerenter', on); t.addEventListener('pointerleave', off);
                                  cleanups.push(() => { t.removeEventListener('pointerenter', on); t.removeEventListener('pointerleave', off); }); });
        } else if (a.type === 'click') {
          let open = false;
          const tog = () => { open = !open; anim.playbackRate = open ? 1 : -1; anim.play(); };
          triggers.forEach(t => { t.style.cursor = 'pointer'; t.addEventListener('click', tog); cleanups.push(() => t.removeEventListener('click', tog)); });
        }
        cleanups.push(() => anim.cancel());
      });
    }
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { ticking = false; const vh = wrapper.clientHeight; for (const f of scrollAnims) f(vh); });
  }

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
          if (!v.src) { v.src = v.dataset.src; v.preload = 'auto'; }
          if (v.hasAttribute('data-autoplay')) { v.muted = true; v.play().catch(() => {}); }
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
        if (v.paused) { if (v.hasAttribute('data-sound')) v.muted = false; v.play().catch(() => {}); } else v.pause();
      }); }
    });
  }

  // ---------- arrows + keys ----------
  const BASE = D.base || '';      // set when hosted under a sub-path (e.g. GitHub Pages project site)
  const url = n => BASE + (n === 1 ? '/' : `/${n}/`);
  function arrows() {
    document.querySelectorAll('.rm-arrows').forEach(x => x.remove());
    const show = V === 'desk' ? D.arrows : D.phoneArrows;
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
  addEventListener('keydown', e => {
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
    if (!wrapper || wrapper.contains(e.target) || e.ctrlKey) return;      // native scroll inside; ctrl = pinch zoom
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
    setupAnimations(); videos();
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
    arrows(); onScroll();
  }
  addEventListener('resize', layout);
  layout();
  window.__rm = { get zoom() { return zoom; }, get variant() { return V; }, get wrapper() { return wrapper; } };
})();
