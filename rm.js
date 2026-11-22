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
        if (a.type === 'scroll') { scrollAnims.push(buildScroll(rec, a, box, top)); return; }
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
    if (intro) intro.update();
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


  // ---------- landing intro (Dev, 22 Nov): scrolling zooms into Diya's laptop ----------
  // A copy of the desk scene sits over the page. Scrolling flies the camera into the laptop screen, where small project
  // icons wait; as it zooms they grow into the work grid's own tiles, landing exactly on them, and the scene dissolves.
  let intro = null;
  function setupIntro() {
    if (intro) { intro.destroy(); intro = null; }
    const cfg = D.variants[V].intro;
    if (!cfg || REDUCED) return;
    const VW = article.clientWidth, VH = article.clientHeight;
    const layer = document.createElement('div'); layer.className = 'rm-intro';
    const cam = document.createElement('div'); cam.className = 'rm-cam'; layer.appendChild(cam);
    const outer = el => { let o = el; while (o.parentElement && (o.parentElement.classList.contains('animation-container') || o.parentElement.tagName === 'A')) o = o.parentElement; return o; };
    const hidden = [], moved = [];
    let screen = null, shade = null;
    for (const it of cfg.items) {
      const el = wid(it.id), im0 = el && el.querySelector('img');
      if (!im0) continue;
      const left = it.c ? VW / 2 + it.x - it.w / 2 : it.x, top = it.c ? VH / 2 + it.y - it.h / 2 : it.y;
      const box = document.createElement('div'); box.className = 'rm-intro-item';
      Object.assign(box.style, { left: left + 'px', top: top + 'px', width: it.w + 'px', height: it.h + 'px', zIndex: it.z });
      const img = new Image(); img.alt = ''; img.src = im0.getAttribute('src'); img.style.objectFit = getComputedStyle(im0).objectFit;
      box.appendChild(img); cam.appendChild(box);
      const o = outer(el); o.classList.add('rm-intro-orig'); hidden.push(o);
      if (it.id === cfg.laptop) {
        const [a, b, c, d] = cfg.screen;
        screen = { x: left + a * it.w, y: top + b * it.h, w: (c - a) * it.w, h: (d - b) * it.h };
        shade = document.createElement('div'); shade.className = 'rm-intro-shade';
        Object.assign(shade.style, { left: screen.x + 'px', top: screen.y + 'px', width: screen.w + 'px', height: screen.h + 'px', zIndex: it.z });
        cam.appendChild(shade);
      }
    }
    // the work grid's tiles, in reading order
    const tiles = [...root.querySelectorAll('.content-scroll-wrapper a.maglink > .rmwidget.widget-picture')]
      .filter(t => parseFloat(t.style.width) >= 200 && !t.closest('.rm-intro-orig'))
      .map(t => ({ href: t.parentElement.getAttribute('href'), img: t.querySelector('img'), x: parseFloat(t.style.left), y: parseFloat(t.style.top), w: parseFloat(t.style.width), h: parseFloat(t.style.height) }))
      .filter(t => t.img).sort((p, q) => p.y - q.y || p.x - q.x).slice(0, 8);
    if (!screen || !tiles.length) { hidden.forEach(o => o.classList.remove('rm-intro-orig')); return; }
    // "Scroll to enter" and its arrow scroll with the page on the phone: lift them above the scene, fading as you go
    const hint = document.createElement('div'); hint.className = 'rm-intro-hint'; layer.appendChild(hint);
    root.querySelectorAll('.content-scroll-wrapper .page-content-container > .animation-container, .content-scroll-wrapper .page-content-container > .rmwidget').forEach(o => {
      const w = o.matches('.rmwidget') ? o : o.querySelector('.rmwidget');
      if (!w || w.matches('.widget-picture') || o.classList.contains('rm-intro-orig')) return;
      if ((parseFloat(o.style.top) || 0) < 300) { moved.push([o, o.parentElement, o.nextSibling]); hint.appendChild(o); }
    });
    // small icons on the laptop screen: two rows of four, near the top (her head covers the lower middle)
    const cols = 4, iw = screen.w * 0.15, gap = (screen.w - cols * iw) / (cols + 1);
    const slots = tiles.map((t, i) => { const h = iw * t.h / t.w, r = Math.floor(i / cols);
      return { x: screen.x + gap + (i % cols) * (iw + gap), y: screen.y + screen.h * 0.11 + r * (h + screen.h * 0.07), w: iw }; });
    const veil = document.createElement('div'); veil.className = 'rm-intro-veil'; layer.appendChild(veil);   // the whole scene fades to black under the icons
    const icons = document.createElement('div'); icons.className = 'rm-icons'; layer.appendChild(icons);
    const els = tiles.map(t => {
      t.img.loading = 'eager';                                   // the grid must be ready under the scene when it dissolves
      const a = document.createElement('a'); a.className = 'rm-icon'; a.href = t.href; a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1;
      a.style.width = t.w + 'px'; a.style.height = t.h + 'px';
      const im = new Image(); im.alt = ''; im.src = t.img.getAttribute('src'); a.appendChild(im); icons.appendChild(a); return a;
    });
    if (V === 'phone') article.insertBefore(layer, article.querySelector('.fixed-position-container-top')); else article.appendChild(layer);
    const O = { x: screen.x + screen.w / 2, y: screen.y + screen.h / 2 };
    const K = Math.max(VW / screen.w, VH / screen.h) * 1.06;     // zoom at which the screen fills the window
    cam.style.transformOrigin = `${O.x}px ${O.y}px`;
    const end = cfg.end;
    let idle = 0;
    function update() {
      // GPU-scale while moving; once still, let the browser redraw the scene sharp at its current size
      cam.classList.add('rm-moving'); clearTimeout(idle); idle = setTimeout(() => cam.classList.remove('rm-moving'), 180);
      // 0 -> .62: the camera flies into the screen; .45 -> .7: the screen darkens to the page's black;
      // .55 -> .95: the icons, now big, rearrange into the grid; .9 -> 1: the scene dissolves into the real page
      const p = clamp01(curY / end), e = easeIO(clamp01(p / 0.62)), s = Math.pow(K, e);
      const tx = (VW / 2 - O.x) * e, ty = (VH / 2 - O.y) * e;
      cam.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      shade.style.opacity = clamp01((p - 0.45) / 0.25);
      veil.style.opacity = clamp01((p - 0.52) / 0.2);
      hint.style.opacity = 1 - clamp01(p * 6);
      const q = easeIO(clamp01((p - 0.55) / 0.4)), st = wrapper.scrollTop;
      els.forEach((a, i) => {
        const sl = slots[i], t = tiles[i];
        const vx = O.x + s * (sl.x - O.x) + tx, vy = O.y + s * (sl.y - O.y) + ty, vw = sl.w * s;   // icon as seen through the camera
        const x = vx + (t.x - vx) * q, y = vy + (t.y - st - vy) * q, k = (vw + (t.w - vw) * q) / t.w;  // ...growing onto its tile
        a.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        a.style.borderRadius = (2.5 * (1 - q)) / k + 'px';
      });
      layer.style.opacity = 1 - clamp01((p - 0.9) / 0.1);
      layer.style.visibility = p >= 1 ? 'hidden' : '';
    }
    intro = {
      update,
      destroy() {
        layer.remove(); hidden.forEach(o => o.classList.remove('rm-intro-orig'));
        moved.forEach(([o, par, next]) => par.insertBefore(o, next && next.parentElement === par ? next : null));
      },
    };
    update();
  }

  // ---------- finish ----------
  // top bars become frosted black glass; images ease in as they scroll into view
  function decorate() {
    const W = D.variants[V].w;
    root.querySelectorAll('.fixed-position-container .rmwidget.widget-shape, .fixed-position-container-top .rmwidget.widget-shape').forEach(sh => {
      const w = parseFloat(sh.style.width), h = parseFloat(sh.style.height);
      if (w >= W * 0.9 && h > 20 && h < 70) sh.classList.add('rm-navbar');
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
        if (it.work) { e.preventDefault(); wrapper.scrollTo({ top: workPos, behavior: 'smooth' }); }
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
    if (n === D.num) wrapper.scrollTo({ top: pos, behavior: 'smooth' });
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
    arrows(); setupIntro(); reveals(); onScroll();
  }
  addEventListener('resize', layout);
  layout();
  const jump = /^#y(\d+)$/.exec(location.hash);
  if (jump) { wrapper.scrollTop = curY = +jump[1]; history.replaceState(null, '', location.pathname + location.search); onScroll(); }
  window.__rm = { get zoom() { return zoom; }, get variant() { return V; }, get wrapper() { return wrapper; } };
})();
