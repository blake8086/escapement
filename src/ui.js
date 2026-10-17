/* ============================================================
   Escapement UI: board rendering, editing, wiring, scrubber.
   Every edit re-runs the simulation from tick 0 and keeps the
   scrub position, so the board always shows the current machine.
   ============================================================ */
(function () {
  const $ = (s) => document.querySelector(s);
  const canvas = $('#board'), wrap = $('#boardWrap'), ctx = canvas.getContext('2d');
  const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ARROWS = { N: '↑', E: '→', S: '↓', W: '←' };
  const SYM_COLORS = ['#7cc0f0', '#f29a7e', '#c3a6f2', '#8fd9a8', '#f2d27e', '#7fd6d0', '#f0a3c8'];
  const symColor = (s) => {
    const n = SYM_COLORS.length, cp = String(s).codePointAt(0) || 65;
    return SYM_COLORS[(((cp - 65) % n) + n) % n];
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const ANG = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
  const lerpAngle = (a, b, t) => a + ((((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * t);

  let COL = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    COL = {
      board: v('--board'), cell: v('--cell'), plate: v('--plate'), recess: v('--recess'), wall: v('--wall'),
      line: v('--line'), ink: v('--ink'), muted: v('--muted'), faint: v('--faint'),
      steel: v('--steel'), steelInk: v('--steel-ink'), steelFill: v('--steel-fill'),
      brass: v('--brass'), brassDim: v('--brass-dim'), brassFill: v('--brass-fill'),
      lit: v('--lit'), litFill: v('--lit-fill'), wire: v('--wire'), ok: v('--ok'), bad: v('--bad'),
    };
  }

  /* ---------- Storage (per-viewer convenience only) ---------- */
  const PREFIX = 'escapement.v1.';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  /* ---------- Sound: everything is synthesized, nothing to load ----------
     Accepted blocks chime on a pentatonic scale by symbol, so a running
     machine plays a little tune. Actuators click, drains bloop, crashes thud. */
  const Sound = (() => {
    let ac = null, master = null, muted = !!store.get('muted', false);
    const SCALE = [523.25, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    function ensure() {
      if (muted) return null;
      if (!ac) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = 0.22;
          master.connect(ac.destination);
        } catch (e) { ac = null; return null; }
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(freq, o) {
      if (!ensure()) return;
      const { type = 'triangle', dur = 0.25, vol = 0.5, when = 0, glide = 0 } = o || {};
      const t0 = ac.currentTime + when, osc = ac.createOscillator(), g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, freq) {
      if (!ensure()) return;
      const n = Math.max(1, Math.floor(ac.sampleRate * dur)), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.1; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
    }
    return {
      get muted() { return muted; },
      setMuted(m) {
        muted = m;
        store.set('muted', m);
        if (ac) (m ? ac.suspend() : ac.resume()).catch(() => {});
      },
      unlock() { ensure(); },
      note(i) { tone(SCALE[Math.max(0, i) % SCALE.length], { dur: 0.4, vol: 0.42 }); },
      tick() { tone(2300, { type: 'sine', dur: 0.025, vol: 0.05 }); },
      click() { noise(0.022, 0.3, 3400); },
      drain() { tone(330, { type: 'sine', dur: 0.2, vol: 0.22, glide: 110 }); },
      fuse() { tone(392, { type: 'sine', dur: 0.12, vol: 0.18 }); tone(587.33, { type: 'sine', dur: 0.16, vol: 0.18, when: 0.05 }); },
      crash() { noise(0.35, 0.9, 380); tone(92, { type: 'sine', dur: 0.45, vol: 0.6, glide: 44 }); },
      fail() { tone(196, { type: 'sawtooth', dur: 0.28, vol: 0.1 }); tone(185, { type: 'sawtooth', dur: 0.32, vol: 0.1, when: 0.03 }); },
      chord(idx) { idx.forEach((i, n) => tone(SCALE[Math.max(0, i) % SCALE.length] / 2, { dur: 0.7, vol: 0.22, when: n * 0.035 })); },
      win() { [0, 1, 2, 4].forEach((i, n) => tone(SCALE[i], { dur: 0.55, vol: 0.38, when: n * 0.09 })); },
    };
  })();

  /* ---------- State ---------- */
  const S = {
    levelIdx: 0, sols: {}, history: {},
    tool: null, placeDir: 'E', sel: null, toolKeys: [],
    testIdx: 0, results: [], pos: 0, playing: false, speed: 2,
    hover: null, drag: null, lastFrame: -1,
    wireFrom: null, // the sensor being wired from, while wiring
  };
  let dpr = 1, cw = 0, ch = 0;
  let geo = { s: 40, ox: 0, oy: 0 };
  let compCache = {};

  const level = () => LEVELS[S.levelIdx];
  function sol() {
    const L = level();
    if (!S.sols[L.id]) S.sols[L.id] = { tiles: {}, links: [] };
    return S.sols[L.id];
  }
  function comp(ti) {
    const L = level(), i = ti == null ? S.testIdx : ti, id = L.id + ':' + i;
    if (!compCache[id]) compCache[id] = compileLevel(L, levelTests(L)[i]);
    return compCache[id];
  }
  const symCache = {};
  function levelSymbols(L) {
    if (symCache[L.id]) return symCache[L.id];
    const set = new Set();
    levelTests(L).forEach((t) => compileLevel(L, t).emitters.forEach((e) => e.seq.forEach((c) => set.add(c))));
    (L.sources || []).forEach((c) => set.add(c));
    (L.recipes || []).forEach((r) => r.forEach((c) => set.add(c)));
    return (symCache[L.id] = [...set].sort());
  }
  function cellKind(x, y) {
    const C = comp(), k = key(x, y);
    if (C.walls.has(k)) return 'wall';
    if (C.emitAt.has(k)) return 'emitter';
    if (C.portAt.has(k)) return 'port';
    if (C.plateAt.has(k)) return 'plate';
    return null;
  }
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < level().w && y < level().h;
  const buildable = (x, y) => inBounds(x, y) && !cellKind(x, y);
  const cur = () => S.results[S.testIdx];
  const frames = () => cur().frames;
  const lastIdx = () => frames().length - 1;
  const pullEmitterAt = (k) => comp().emitters.find((e) => key(e.x, e.y) === k && e.mode === 'pull');

  // Older saves used parts that have since been merged or simplified; map them onto today's parts.
  function sanitizeSol(s) {
    const tiles = {};
    if (s && s.tiles) {
      for (const [k, t] of Object.entries(s.tiles)) {
        if (!t || !t.type) continue;
        if (t.type === 'counter') tiles[k] = { type: 'toggle' };
        else if (t.type === 'clock') tiles[k] = { type: 'clock', k: (t.k | 0) % 2 };
        else if (t.type === 'turn') tiles[k] = { type: 'redirect', dir: t.dir || 'E' };
        else if (t.type === 'stop') tiles[k] = { type: 'gate' };
        else if (TILE_DEFS[t.type]) { tiles[k] = Object.assign({}, t); delete tiles[k].inv; }
      }
    }
    return { tiles, links: s && Array.isArray(s.links) ? s.links : [] };
  }

  /* ---------- Simulation glue ---------- */
  function resim() {
    const L = level();
    S.results = levelTests(L).map((_, i) => simulate(L, i, sol()));
    S.pos = Math.min(S.pos, lastIdx());
    S.improved = null;
    if (S.results.every((r) => r.result.status === 'win')) {
      const cost = solutionCost(sol());
      const ticks = Math.max(...S.results.map((r) => r.result.t));
      const area = Math.max(...S.results.map((r) => r.result.area));
      const best = store.get('best.' + L.id, null);
      // Remember whether this machine set a personal best, for the solve card.
      S.improved = {
        cost: !best || cost < best.cost, ticks: !best || ticks < best.ticks,
        area: !best || best.area == null || area < best.area,
      };
      store.set('best.' + L.id, best
        ? { cost: Math.min(best.cost, cost), ticks: Math.min(best.ticks, ticks), area: Math.min(best.area == null ? area : best.area, area) }
        : { cost, ticks, area });
    }
    S.lastFrame = -1;
    renderLevels();
    renderResult();
    renderScore();
    syncScrub();
    updateLive();
  }

  function save() { store.set('sol.' + level().id, sol()); }
  function pruneLinks(s) {
    s.links = s.links.filter((l) => {
      const a = s.tiles[l.from], b = s.tiles[l.to];
      return a && isSensorType(a.type) && ((b && isActuatorType(b.type)) || pullEmitterAt(l.to));
    });
  }
  function edit(fn) {
    hideCelebration();
    const id = level().id;
    (S.history[id] = S.history[id] || []).push(JSON.stringify(sol()));
    if (S.history[id].length > 200) S.history[id].shift();
    fn(sol());
    pruneLinks(sol());
    save();
    resim();
    renderInspector();
    draw();
  }
  function undo() {
    const h = S.history[level().id];
    if (!h || !h.length) { toast('Nothing to undo'); return; }
    S.sols[level().id] = JSON.parse(h.pop());
    if (S.sel && !sol().tiles[S.sel] && !comp().emitAt.has(S.sel)) S.sel = null;
    if (S.wireFrom && !sol().tiles[S.wireFrom]) S.wireFrom = null;
    save();
    resim();
    renderInspector();
    draw();
  }

  function loadLevel(i) {
    S.levelIdx = i;
    S.testIdx = 0; S.pos = 0; S.playing = false; S.sel = null; S.tool = null; S.drag = null; S.wireFrom = null;
    S.results = [];
    compCache = {};
    hideCelebration();
    const L = level();
    if (!S.sols[L.id]) S.sols[L.id] = sanitizeSol(store.get('sol.' + L.id, null));
    store.set('level', i);
    wrap.style.setProperty('--ar', ((L.w + 0.8) / (L.h + 1.1)).toFixed(3));
    syncPlay();
    renderInfo();
    renderPalette();
    renderInspector();
    resim();
    fit();
  }

  /* ---------- Drawing primitives ---------- */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function arrowSeg(c, x1, y1, x2, y2, w, color) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const hl = Math.max(w * 2.3, len * 0.42), hw = hl * 0.72;
    c.save();
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - ux * hl * 0.7, y2 - uy * hl * 0.7); c.stroke();
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - ux * hl - uy * hw / 2, y2 - uy * hl + ux * hw / 2);
    c.lineTo(x2 - ux * hl + uy * hw / 2, y2 - uy * hl - ux * hw / 2);
    c.closePath(); c.fill();
    c.restore();
  }
  function arrow(c, cx, cy, dir, len, w, color) {
    const [dx, dy] = DIRS[dir];
    arrowSeg(c, cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2, w, color);
  }
  function miniChip(c, sym, cx, cy, size, alpha, ghost) {
    c.save();
    c.globalAlpha *= alpha == null ? 1 : alpha;
    rr(c, cx - size / 2, cy - size / 2, size, size, size * 0.22);
    const col = symColor(sym);
    if (ghost) {
      c.lineWidth = Math.max(1, size * 0.07); c.strokeStyle = col; c.setLineDash([size * 0.14, size * 0.1]); c.stroke(); c.setLineDash([]);
      c.fillStyle = col;
    } else {
      c.fillStyle = col; c.fill(); c.fillStyle = '#10161b';
    }
    c.font = `700 ${Math.round(size * 0.62)}px ${FONT_MONO}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(sym, cx, cy + size * 0.04);
    c.restore();
  }
  function tinyText(c, text, x, y, s, color, align) {
    c.save();
    c.font = `500 ${Math.max(9, Math.round(s * 0.17))}px ${FONT_MONO}`;
    c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
    c.fillText(text, x, y);
    c.restore();
  }

  /* A part, drawn the same way on the board, in the palette and in the inspector. */
  function drawTile(c, t, cx, cy, s, st) {
    st = st || {};
    const fam = TILE_DEFS[t.type].family, lw = Math.max(1, s * 0.03);
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (fam === 'static') {
      rr(c, cx - 0.42 * s, cy - 0.42 * s, 0.84 * s, 0.84 * s, 0.1 * s);
      c.fillStyle = COL.steelFill; c.fill();
      c.lineWidth = lw; c.strokeStyle = COL.steel; c.stroke();
      if (t.type === 'filter') {
        const [dx, dy] = DIRS[t.dir];
        arrowSeg(c, cx - dx * 0.02 * s, cy - dy * 0.02 * s, cx + dx * 0.36 * s, cy + dy * 0.36 * s, 0.085 * s, COL.steelInk);
        miniChip(c, t.sym, cx - dx * 0.19 * s, cy - dy * 0.19 * s, 0.3 * s);
      } else if (t.type === 'drain') {
        [0.29, 0.19].forEach((r) => { c.beginPath(); c.arc(cx, cy, r * s, 0, Math.PI * 2); c.lineWidth = lw * 1.4; c.strokeStyle = COL.steelInk; c.stroke(); });
        c.beginPath(); c.arc(cx, cy, 0.09 * s, 0, Math.PI * 2); c.fillStyle = COL.recess; c.fill();
        c.lineWidth = lw; c.strokeStyle = COL.steelInk; c.stroke();
      } else if (t.type === 'join') {
        // Two arms converge on the product; the arrow shows where the product goes.
        const [dx, dy] = DIRS[t.dir], px = -dy, py = dx;
        const bx = cx - dx * 0.3 * s, by = cy - dy * 0.3 * s;
        c.strokeStyle = COL.steelInk; c.lineWidth = lw * 2;
        [-1, 1].forEach((sg) => {
          c.beginPath();
          c.moveTo(bx + px * sg * 0.26 * s, by + py * sg * 0.26 * s);
          c.lineTo(cx - dx * 0.1 * s + px * sg * 0.09 * s, cy - dy * 0.1 * s + py * sg * 0.09 * s);
          c.stroke();
        });
        arrowSeg(c, cx + dx * 0.16 * s, cy + dy * 0.16 * s, cx + dx * 0.4 * s, cy + dy * 0.4 * s, 0.07 * s, COL.steelInk);
        if (t.out) miniChip(c, t.out, cx - dx * 0.02 * s, cy - dy * 0.02 * s, 0.32 * s);
      }
    } else if (fam === 'sensor') {
      const on = !!st.on, ink = on ? COL.lit : COL.brass;
      c.beginPath(); c.arc(cx, cy, 0.4 * s, 0, Math.PI * 2);
      c.fillStyle = on ? COL.litFill : COL.brassFill; c.fill();
      c.lineWidth = lw * 1.4; c.strokeStyle = ink;
      if (on) { c.shadowColor = COL.lit; c.shadowBlur = s * 0.28; }
      c.stroke(); c.shadowBlur = 0;
      if (t.type === 'presence') {
        c.beginPath(); c.arc(cx, cy, 0.2 * s, 0, Math.PI * 2); c.lineWidth = lw * 1.3; c.stroke();
        c.beginPath(); c.arc(cx, cy, 0.075 * s, 0, Math.PI * 2); c.fillStyle = ink; c.fill();
      } else if (t.type === 'kind') {
        miniChip(c, t.sym, cx, cy, 0.36 * s);
        if (on) { rr(c, cx - 0.21 * s, cy - 0.21 * s, 0.42 * s, 0.42 * s, 0.09 * s); c.lineWidth = lw * 1.2; c.strokeStyle = ink; c.stroke(); }
      } else if (t.type === 'clock') {
        // Two pips, top and bottom. The hand flips between them every tick; the ringed pip is the lit one.
        const pip = st.pip || 0, mark = t.k || 0;
        for (let i = 0; i < 2; i++) {
          const py = cy + (i ? 0.25 : -0.25) * s;
          c.beginPath(); c.arc(cx, py, 0.055 * s, 0, Math.PI * 2);
          c.fillStyle = i === pip ? ink : COL.brassDim; c.fill();
          if (i === mark) { c.beginPath(); c.arc(cx, py, 0.095 * s, 0, Math.PI * 2); c.lineWidth = lw; c.strokeStyle = ink; c.stroke(); }
        }
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy + (pip ? 0.15 : -0.15) * s);
        c.lineWidth = lw * 1.6; c.strokeStyle = ink; c.stroke();
        c.beginPath(); c.arc(cx, cy, 0.045 * s, 0, Math.PI * 2); c.fillStyle = ink; c.fill();
      } else if (t.type === 'toggle') {
        // A lever that flips left (dark) or right (lit) each time a block arrives.
        const ex = cx + (on ? 0.19 : -0.19) * s, ey = cy - 0.12 * s, py = cy + 0.15 * s;
        [-1, 1].forEach((sg) => { c.beginPath(); c.arc(cx + sg * 0.19 * s, ey, 0.04 * s, 0, Math.PI * 2); c.fillStyle = COL.brassDim; c.fill(); });
        c.beginPath(); c.moveTo(cx, py); c.lineTo(ex, ey); c.lineWidth = lw * 2; c.strokeStyle = ink; c.stroke();
        c.beginPath(); c.arc(ex, ey, 0.08 * s, 0, Math.PI * 2); c.fillStyle = ink; c.fill();
        c.beginPath(); c.arc(cx, py, 0.065 * s, 0, Math.PI * 2); c.fillStyle = COL.recess; c.fill();
        c.lineWidth = lw * 1.2; c.strokeStyle = ink; c.stroke();
      }
    } else {
      // Unwired actuators are always on and drawn plain. Wired ones glow while lit and fade while dark.
      const wired = !!st.wired, on = wired ? !!st.lit : true, glow = wired && on;
      const ink = glow ? COL.lit : COL.brass;
      rr(c, cx - 0.4 * s, cy - 0.4 * s, 0.8 * s, 0.8 * s, 0.14 * s);
      c.fillStyle = glow ? COL.litFill : COL.brassFill; c.fill();
      c.lineWidth = lw * 1.4; c.strokeStyle = ink;
      if (glow) { c.shadowColor = COL.lit; c.shadowBlur = s * 0.28; }
      c.stroke(); c.shadowBlur = 0;
      if (t.type === 'redirect') {
        c.globalAlpha = on ? 1 : 0.35;
        arrow(c, cx, cy, t.dir, 0.56 * s, 0.1 * s, ink);
        c.globalAlpha = 1;
      } else if (t.type === 'source') {
        // A hopper: its symbol, and a spout on the side blocks leave from.
        const [dx, dy] = DIRS[t.dir];
        c.globalAlpha = on ? 1 : 0.45;
        if (t.sym) miniChip(c, t.sym, cx - dx * 0.07 * s, cy - dy * 0.07 * s, 0.36 * s);
        arrowSeg(c, cx + dx * 0.2 * s, cy + dy * 0.2 * s, cx + dx * 0.41 * s, cy + dy * 0.41 * s, 0.07 * s, ink);
        c.globalAlpha = 1;
      } else if (t.type === 'gate') {
        c.strokeStyle = ink; c.lineWidth = lw * 2;
        [-1, 1].forEach((sg) => { c.beginPath(); c.moveTo(cx + sg * 0.2 * s, cy - 0.22 * s); c.lineTo(cx + sg * 0.2 * s, cy + 0.22 * s); c.stroke(); });
        if (on) {
          [-0.08, 0.08].forEach((o) => { c.beginPath(); c.moveTo(cx - 0.2 * s, cy + o * s); c.lineTo(cx + 0.2 * s, cy + o * s); c.stroke(); });
        } else {
          [-1, 1].forEach((sg) => { c.beginPath(); c.moveTo(cx + sg * 0.2 * s, cy); c.lineTo(cx + sg * 0.12 * s, cy); c.stroke(); });
        }
      }
    }
    c.restore();
  }

  /* A block is shaped like an arrow tag pointing along its heading. The body
     rotates as the block turns; the symbol stays upright. */
  function drawBlock(c, b, cx, cy, s, alpha, outline) {
    const ang = b.ang != null ? b.ang : ANG[b.dir];
    const hw = 0.31 * s, back = -0.33 * s, shoulder = 0.12 * s, tip = 0.42 * s, r = 0.08 * s;
    c.save();
    c.globalAlpha = alpha == null ? 1 : alpha;
    c.translate(cx, cy);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(back + r, -hw);
    c.lineTo(shoulder, -hw);
    c.lineTo(tip, 0);
    c.lineTo(shoulder, hw);
    c.lineTo(back + r, hw);
    c.arcTo(back, hw, back, hw - r, r);
    c.lineTo(back, -hw + r);
    c.arcTo(back, -hw, back + r, -hw, r);
    c.closePath();
    if (outline) { c.shadowColor = outline; c.shadowBlur = s * 0.3; }
    c.fillStyle = symColor(b.sym); c.fill();
    c.shadowBlur = 0;
    c.lineJoin = 'round';
    c.lineWidth = Math.max(1, s * (outline ? 0.05 : 0.025)); c.strokeStyle = outline || 'rgba(8,12,16,0.45)'; c.stroke();
    c.rotate(-ang);
    const mid = (back + shoulder) / 2 + 0.03 * s;
    c.fillStyle = '#10161b';
    c.font = `700 ${Math.round(s * 0.33)}px ${FONT_MONO}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(b.sym, Math.cos(ang) * mid, Math.sin(ang) * mid + s * 0.015);
    c.restore();
  }

  /* ---------- Board layout ---------- */
  function fit() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = window.devicePixelRatio || 1;
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const L = level(), pad = 22;
    const s = Math.max(18, Math.floor(Math.min((cw - pad * 2) / L.w, (ch - pad * 2 - 12) / L.h, 88)));
    geo = { s, ox: Math.round((cw - L.w * s) / 2), oy: Math.round((ch - L.h * s) / 2 + 6) };
    draw();
  }
  const cxOf = (x) => geo.ox + (x + 0.5) * geo.s;
  const cyOf = (y) => geo.oy + (y + 0.5) * geo.s;

  /* What the board shows at the current scrub position, interpolating between beats. */
  function view() {
    const fr = frames(), last = fr.length - 1;
    let i = Math.floor(S.pos + 1e-9), f = S.pos - i;
    if (i >= last) { i = last; f = 0; }
    if (REDUCED) f = 0;
    const A = fr[i], B = fr[Math.min(i + 1, last)];
    const E = { sensors: A.sensors, act: A.act, links: A.links, emit: A.emit, ports: A.ports, plates: A.plates };
    let pulse = null;
    const blocks = [];
    const crashBlocks = (F, amt) => {
      F.blocks.forEach((b) => {
        const tk = F.crash.targets[b.id];
        let x = b.x, y = b.y, outline = null;
        if (tk) { const [tx, ty] = unkey(tk); x = lerp(b.x, tx, 0.36 * amt); y = lerp(b.y, ty, 0.36 * amt); outline = COL.bad; }
        else if (F.crash.ids.includes(b.id)) outline = COL.bad;
        blocks.push({ ...b, x, y, alpha: 1, outline: amt > 0.5 ? outline : null });
      });
    };
    if (f > 0 && B.beat === 'tock') {
      E.sensors = B.sensors; E.links = B.links;
      pulse = Math.min(1, f / 0.8);
      if (f > 0.8) E.act = B.act;
      if (f > 0.5) E.plates = B.plates;
      B.blocks.forEach((b) => blocks.push({ ...b, alpha: 1 }));
      (B.cleared || []).forEach((b) => blocks.push({ ...b, alpha: 1 - f }));
    } else if (f > 0 && B.beat === 'tick') {
      const e = ease(f);
      if (B.crash) {
        crashBlocks({ blocks: A.blocks, crash: B.crash }, e);
      } else {
        const am = new Map(A.blocks.map((b) => [b.id, b]));
        B.blocks.forEach((b) => {
          const a = am.get(b.id);
          if (a) blocks.push({ ...b, x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), ang: lerpAngle(ANG[a.dir], ANG[b.dir], ease(clamp01((f - 0.35) / 0.65))), alpha: 1 });
          else blocks.push({ ...b, alpha: e });
        });
        (B.gone || []).forEach((g) => {
          const a = am.get(g.id);
          if (!a) return;
          blocks.push({ ...g, x: lerp(a.x, g.x, e), y: lerp(a.y, g.y, e), dir: a.dir, alpha: 1 - Math.max(0, (f - 0.45) / 0.55) });
        });
      }
      if (f > 0.5) { E.emit = B.emit; E.ports = B.ports; }
    } else if (A.crash) {
      crashBlocks(A, 1);
    } else {
      A.blocks.forEach((b) => blocks.push({ ...b, alpha: 1 }));
    }
    const mark = f > 0.5 ? B : A;
    // Rings that bloom from ports (and shrink into drains) just after a block is taken.
    const pops = f > 0 && A.beat === 'tick' && !A.crash && !REDUCED
      ? (A.gone || []).filter((g) => g.how !== 'join').map((g) => ({ ...g, p: f }))
        .concat((A.fused || []).map((g) => ({ ...g, how: 'port', p: f })))
      : [];
    return { A, B, f, E, pulse, blocks, mark, pops };
  }
  function drawPop(g) {
    const s = geo.s, cx = cxOf(g.x), cy = cyOf(g.y), p = g.p;
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.lineWidth = Math.max(1.5, s * 0.07 * (1 - p));
    ctx.strokeStyle = g.how === 'port' ? symColor(g.sym) : COL.steelInk;
    ctx.beginPath();
    ctx.arc(cx, cy, s * (g.how === 'port' ? 0.26 + 0.38 * p : 0.34 - 0.24 * p), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function tileState(k, t, E, wired) {
    const fam = TILE_DEFS[t.type].family;
    if (fam === 'sensor') return E.sensors[k] || {};
    if (fam === 'actuator') return { lit: !!E.act[k], wired: wired.has(k) };
    return {};
  }

  /* ---------- Board pieces ---------- */
  function drawWall(X, Y, s) {
    ctx.save();
    rr(ctx, X + 1.5, Y + 1.5, s - 3, s - 3, Math.min(6, s * 0.1));
    ctx.fillStyle = COL.wall; ctx.fill(); ctx.clip();
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    for (let d = -s; d < s; d += s / 5) { ctx.beginPath(); ctx.moveTo(X + d, Y + s); ctx.lineTo(X + d + s, Y); ctx.stroke(); }
    ctx.restore();
  }

  function drawPlate(p, i, V) {
    const s = geo.s, X = geo.ox + p.x * s, Y = geo.oy + p.y * s;
    ctx.save();
    rr(ctx, X + 2, Y + 2, p.w * s - 4, p.h * s - 4, 8);
    ctx.lineWidth = Math.max(1.5, s * 0.035); ctx.strokeStyle = COL.brassDim;
    ctx.setLineDash([s * 0.12, s * 0.08]); ctx.stroke(); ctx.setLineDash([]);
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) {
      miniChip(ctx, p.pattern[dy][dx], X + (dx + 0.5) * s, Y + (dy + 0.5) * s, 0.46 * s, 0.6, true);
    }
    const done = V.E.plates[i], label = `${p.id} ${done}/${p.need}`;
    ctx.font = `600 ${Math.max(10, Math.round(s * 0.2))}px ${FONT_MONO}`;
    const tw = ctx.measureText(label).width, ph = Math.max(16, s * 0.3), px = X + p.w * s - tw - 18, py = Y - ph / 2;
    rr(ctx, px, py, tw + 14, ph, ph / 2);
    ctx.fillStyle = COL.recess; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = COL.brassDim; ctx.stroke();
    ctx.fillStyle = done >= p.need ? COL.ok : COL.muted;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, px + 7, py + ph / 2 + 1);
    ctx.restore();
  }

  function drawPort(p, i, V) {
    const s = geo.s, cx = cxOf(p.x), cy = cyOf(p.y);
    const got = V.E.ports[i], need = p.expect.length, done = got >= need;
    ctx.save();
    rr(ctx, cx - 0.44 * s, cy - 0.44 * s, 0.88 * s, 0.88 * s, 0.14 * s);
    ctx.fillStyle = COL.recess; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = done ? COL.ok : COL.faint; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 0.27 * s, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = COL.line; ctx.stroke();
    if (!done) miniChip(ctx, p.expect[got], cx, cy, 0.32 * s, 0.55, true);
    else {
      ctx.strokeStyle = COL.ok; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.moveTo(cx - 0.13 * s, cy); ctx.lineTo(cx - 0.03 * s, cy + 0.1 * s); ctx.lineTo(cx + 0.15 * s, cy - 0.1 * s); ctx.stroke();
    }
    tinyText(ctx, p.id, cx - 0.36 * s, cy - 0.24 * s, s, COL.muted);
    tinyText(ctx, `${got}/${need}`, cx + 0.36 * s, cy + 0.38 * s, s, done ? COL.ok : COL.faint, 'right');
    ctx.restore();
  }

  function drawEmitter(e, i, V) {
    const s = geo.s, cx = cxOf(e.x), cy = cyOf(e.y), k = key(e.x, e.y);
    const pulledLit = e.mode === 'pull' && !!V.E.act[k];
    ctx.save();
    rr(ctx, cx - 0.44 * s, cy - 0.44 * s, 0.88 * s, 0.88 * s, 0.14 * s);
    ctx.fillStyle = COL.recess; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = pulledLit ? COL.lit : COL.brassDim;
    if (pulledLit) { ctx.shadowColor = COL.lit; ctx.shadowBlur = s * 0.25; }
    ctx.stroke(); ctx.shadowBlur = 0;
    const [dx, dy] = DIRS[e.dir];
    arrowSeg(ctx, cx + dx * 0.26 * s, cy + dy * 0.26 * s, cx + dx * 0.47 * s, cy + dy * 0.47 * s, 0.06 * s, COL.brass);
    const n = V.E.emit[i], left = e.cycle ? Infinity : e.seq.length - n;
    if (left > 0) miniChip(ctx, e.seq[n % e.seq.length], cx - dx * 0.04 * s, cy - dy * 0.04 * s, 0.32 * s);
    tinyText(ctx, e.id, cx - 0.36 * s, cy - 0.24 * s, s, COL.muted);
    tinyText(ctx, e.cycle ? '∞' : String(left), cx + 0.36 * s, cy - 0.24 * s, s, COL.faint, 'right');
    if (e.mode === 'push') {
      const m = V.mark.t, pip = (((m - e.phase) % e.period) + e.period) % e.period;
      const gap = 0.12 * s, y0 = cy + 0.31 * s;
      for (let j = 0; j < e.period; j++) {
        const px = cx + (j - (e.period - 1) / 2) * gap;
        ctx.beginPath(); ctx.arc(px, y0, 0.035 * s, 0, Math.PI * 2);
        ctx.fillStyle = j === pip ? COL.brass : COL.brassDim; ctx.fill();
        if (j === 0) { ctx.beginPath(); ctx.arc(px, y0, 0.06 * s, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = COL.brass; ctx.stroke(); }
      }
    } else {
      ctx.beginPath(); ctx.arc(cx, cy + 0.31 * s, 0.05 * s, 0, Math.PI * 2);
      ctx.fillStyle = pulledLit ? COL.lit : COL.recess; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = pulledLit ? COL.lit : COL.brass; ctx.stroke();
    }
    ctx.restore();
  }

  function pathPoints(l) {
    const cells = l.path && l.path.length >= 2 ? l.path : [unkey(l.from), unkey(l.to)];
    return cells.map(([x, y]) => [cxOf(x), cyOf(y)]);
  }
  function trimPoints(pts, a, b) {
    const out = pts.map((p) => p.slice());
    const move = (p, q, d) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, t = Math.min(d, len * 0.45) / len;
      p[0] += (q[0] - p[0]) * t; p[1] += (q[1] - p[1]) * t;
    };
    if (out.length >= 2) { move(out[0], out[1], a); move(out[out.length - 1], out[out.length - 2], b); }
    return out;
  }
  // Point and unit tangent at fraction f of a polyline's length.
  function pointAlong(pts, f) {
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
    let d = Math.max(0, Math.min(1, f)) * total;
    for (let i = 0; i < segs.length; i++) {
      if ((d <= segs[i] && segs[i] > 0) || i === segs.length - 1) {
        const L = segs[i] || 1, t = Math.min(1, d / L);
        return [lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), (pts[i + 1][0] - pts[i][0]) / L, (pts[i + 1][1] - pts[i][1]) / L];
      }
      d -= segs[i];
    }
    const p = pts[pts.length - 1];
    return [p[0], p[1], 1, 0];
  }
  function polyLength(pts) {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return t;
  }
  // Drop the cells a wire passes straight through, keeping only its corners.
  function corners(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) > 1e-6) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  /* Wire shape: each corner of the cell route bends as wide as its neighbors allow. */
  function wireCurve(pts) {
    if (pts.length < 3) return pts;
    const c = corners(pts);
    if (c.length < 3) return c;
    const out = [c[0]];
    for (let i = 1; i < c.length - 1; i++) {
      const a = c[i - 1], b = c[i], d = c[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(d[0] - b[0], d[1] - b[1]) || 1;
      const cap1 = i === 1 ? l1 * 0.85 : l1 / 2, cap2 = i === c.length - 2 ? l2 * 0.85 : l2 / 2;
      const r = Math.min(cap1, cap2);
      const e = [b[0] - (b[0] - a[0]) / l1 * r, b[1] - (b[1] - a[1]) / l1 * r];
      const x = [b[0] + (d[0] - b[0]) / l2 * r, b[1] + (d[1] - b[1]) / l2 * r];
      out.push(e);
      for (let j = 1; j <= 12; j++) {
        const t = j / 12, mt = 1 - t;
        out.push([mt * mt * e[0] + 2 * mt * t * b[0] + t * t * x[0], mt * mt * e[1] + 2 * mt * t * b[1] + t * t * x[1]]);
      }
    }
    out.push(c[c.length - 1]);
    return out;
  }
  function strokePoly(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  function drawWire(l, lit, pulse) {
    const s = geo.s;
    const pts = wireCurve(trimPoints(pathPoints(l), 0.36 * s, 0.42 * s));
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = lit ? COL.lit : COL.wire;
    ctx.lineWidth = Math.max(1.5, s * (lit ? 0.07 : 0.055));
    if (lit) { ctx.shadowColor = COL.lit; ctx.shadowBlur = s * 0.2; }
    strokePoly(pts);
    ctx.shadowBlur = 0;
    // arrowhead at the actuator end
    const [x2, y2, ux, uy] = pointAlong(pts, 1), hl = s * 0.16, hw = s * 0.11;
    ctx.fillStyle = lit ? COL.lit : COL.wire;
    ctx.beginPath();
    ctx.moveTo(x2 + ux * hl * 0.4, y2 + uy * hl * 0.4);
    ctx.lineTo(x2 - ux * hl * 0.6 - uy * hw, y2 - uy * hl * 0.6 + ux * hw);
    ctx.lineTo(x2 - ux * hl * 0.6 + uy * hw, y2 - uy * hl * 0.6 - ux * hw);
    ctx.closePath(); ctx.fill();
    // direction chevrons, one per cell of length, following the curve
    const total = polyLength(pts);
    for (let d = s * 0.9; d < total - s * 0.45; d += s) {
      const [mx, my, vx, vy] = pointAlong(pts, d / total), c = s * 0.07;
      ctx.beginPath();
      ctx.moveTo(mx - vx * c - vy * c, my - vy * c + vx * c);
      ctx.lineTo(mx + vx * c, my + vy * c);
      ctx.lineTo(mx - vx * c + vy * c, my - vy * c - vx * c);
      ctx.lineWidth = Math.max(1.2, s * 0.03); ctx.strokeStyle = lit ? '#2a1d0c' : COL.board; ctx.stroke();
    }
    if (lit && pulse != null && pulse < 1) {
      const [px, py] = pointAlong(pts, pulse);
      ctx.beginPath(); ctx.arc(px, py, s * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = '#fff1d6'; ctx.shadowColor = COL.lit; ctx.shadowBlur = s * 0.35; ctx.fill();
    }
    ctx.restore();
  }

  function drawCrashMark(k) {
    const s = geo.s, [x, y] = unkey(k), cx = cxOf(x), cy = cyOf(y);
    ctx.save();
    ctx.strokeStyle = COL.bad; ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath(); ctx.arc(cx, cy, 0.46 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.14 * s, cy - 0.14 * s); ctx.lineTo(cx + 0.14 * s, cy + 0.14 * s);
    ctx.moveTo(cx + 0.14 * s, cy - 0.14 * s); ctx.lineTo(cx - 0.14 * s, cy + 0.14 * s); ctx.stroke();
    ctx.restore();
  }
  function outlineCell(k, color, width, dash) {
    const s = geo.s, [x, y] = unkey(k);
    ctx.save();
    rr(ctx, geo.ox + x * s + 2, geo.oy + y * s + 2, s - 4, s - 4, Math.min(8, s * 0.14));
    ctx.lineWidth = width; ctx.strokeStyle = color;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- Main draw ---------- */
  function draw() {
    if (!S.results.length || !cw) return;
    const L = level(), C = comp(), s = geo.s, ox = geo.ox, oy = geo.oy, sl = sol();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const V = view();

    rr(ctx, ox - 7, oy - 7, L.w * s + 14, L.h * s + 14, 12);
    ctx.fillStyle = COL.board; ctx.fill();
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const kd = cellKind(x, y), X = ox + x * s, Y = oy + y * s;
      if (kd === 'wall') { drawWall(X, Y, s); continue; }
      rr(ctx, X + 1.5, Y + 1.5, s - 3, s - 3, Math.min(6, s * 0.1));
      ctx.fillStyle = kd === 'plate' ? COL.plate : COL.cell; ctx.fill();
    }

    C.plates.forEach((p, i) => drawPlate(p, i, V));
    C.ports.forEach((p, i) => drawPort(p, i, V));
    C.emitters.forEach((e, i) => drawEmitter(e, i, V));

    const links = validLinks(C, sl), wired = new Set(links.map((l) => l.to));
    const lifting = S.drag && S.drag.mode === 'move' && S.drag.lifted ? S.drag.key : null;
    for (const [k, t] of Object.entries(sl.tiles)) {
      const [x, y] = unkey(k);
      ctx.save();
      if (k === lifting) ctx.globalAlpha = 0.28;
      drawTile(ctx, t, cxOf(x), cyOf(y), s, tileState(k, t, V.E, wired));
      ctx.restore();
    }

    links.forEach((l, i) => drawWire(l, !!V.E.links[i], V.pulse));

    // ghost of the part about to be placed
    if (S.tool && S.hover && !S.drag) {
      const [hx, hy] = unkey(S.hover);
      if (buildable(hx, hy) && !sl.tiles[S.hover]) {
        ctx.save(); ctx.globalAlpha = 0.45;
        drawTile(ctx, defaultTile(S.tool), cxOf(hx), cyOf(hy), s, {});
        ctx.restore();
      }
    }

    // Wiring: mark every part the sensor can feed (solid if already wired), and
    // draw a dashed wire from the sensor to the part under the pointer.
    if (S.wireFrom && sl.tiles[S.wireFrom]) {
      const fed = new Set(sl.links.filter((l) => l.from === S.wireFrom).map((l) => l.to));
      const targets = Object.keys(sl.tiles).filter((k) => isActuatorType(sl.tiles[k].type))
        .concat(C.emitters.filter((e) => e.mode === 'pull').map((e) => key(e.x, e.y)));
      targets.forEach((k) => outlineCell(k, fed.has(k) ? COL.brass : COL.brassDim, fed.has(k) ? 1.5 : 1, fed.has(k) ? null : [3, 3]));
      if (S.hover && S.hover !== S.wireFrom && !S.drag && targets.includes(S.hover)) {
        const pts = autoPath(unkey(S.wireFrom), unkey(S.hover)).map(([x, y]) => [cxOf(x), cyOf(y)]);
        ctx.save();
        ctx.strokeStyle = COL.lit; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(1.5, s * 0.05);
        ctx.setLineDash([s * 0.12, s * 0.09]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        strokePoly(wireCurve(trimPoints(pts, 0.36 * s, 0.42 * s)));
        ctx.restore();
        outlineCell(S.hover, COL.lit, Math.max(1.5, s * 0.045));
      }
    }

    V.blocks.forEach((b) => drawBlock(ctx, b, cxOf(b.x), cyOf(b.y), s, b.alpha, b.outline));
    V.pops.forEach(drawPop);

    const M = V.mark;
    if (M.crash) M.crash.cells.forEach(drawCrashMark);
    if (M.fail) M.fail.cells.forEach((k) => outlineCell(k, COL.bad, Math.max(2, s * 0.06)));

    if (S.sel) outlineCell(S.sel, COL.brass, Math.max(1.5, s * 0.04));
    if (S.hover && S.hover !== S.sel && !S.drag) {
      const [hx, hy] = unkey(S.hover);
      if (sl.tiles[S.hover] || cellKind(hx, hy) === 'emitter') outlineCell(S.hover, COL.faint, 1);
    }
    drawFloating(V, wired);
  }

  /* The part under the pointer while it's being dragged, plus where it would land. */
  function drawFloating(V, wired) {
    const d = S.drag;
    if (!d || !d.lifted || (d.mode !== 'move' && d.mode !== 'new')) return;
    if (d.px == null || d.px < 0 || d.py < 0 || d.px > cw || d.py > ch) return;
    const s = geo.s, sl = sol();
    const t = d.mode === 'move' ? sl.tiles[d.key] : defaultTile(d.type);
    if (!t) return;
    const c = cellAtPt({ x: d.px, y: d.py });
    if (c) {
      const k = key(c.x, c.y);
      const ok = (d.mode === 'move' && k === d.key) || (buildable(c.x, c.y) && !sl.tiles[k]);
      outlineCell(k, ok ? COL.brass : COL.bad, Math.max(1.5, s * 0.045), ok ? null : [5, 4]);
    }
    ctx.save();
    ctx.globalAlpha = c ? 0.92 : 0.5;
    drawTile(ctx, t, d.px, d.py, s * 1.06, d.mode === 'move' ? tileState(d.key, t, V.E, wired) : {});
    ctx.restore();
    if (!c && d.mode === 'move') {
      // Off the board: letting go here removes the part.
      const r = s * 0.13, bx = d.px + s * 0.36, by = d.py - s * 0.36;
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fillStyle = COL.bad; ctx.fill();
      ctx.strokeStyle = '#1a0e0e'; ctx.lineWidth = Math.max(1.5, s * 0.03); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.45, by - r * 0.45); ctx.lineTo(bx + r * 0.45, by + r * 0.45);
      ctx.moveTo(bx + r * 0.45, by - r * 0.45); ctx.lineTo(bx - r * 0.45, by + r * 0.45);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- Editing ---------- */
  function defaultTile(type) {
    const t = { type };
    if (type === 'filter' || type === 'redirect' || type === 'source' || type === 'join') t.dir = S.placeDir;
    if (type === 'filter' || type === 'kind') t.sym = levelSymbols(level())[0];
    if (type === 'source') t.sym = (level().sources || [])[0] || 'A';
    if (type === 'join') t.out = ((level().recipes || [])[0] || [])[2];
    if (type === 'clock') t.k = 0;
    return t;
  }
  function placeTile(k, type) { edit((s) => { s.tiles[k] = defaultTile(type); }); }
  function removeTileAt(k) {
    if (!sol().tiles[k]) return;
    if (S.wireFrom === k) S.wireFrom = null;
    edit((s) => { delete s.tiles[k]; });
    if (S.sel === k) { S.sel = null; renderInspector(); draw(); }
  }
  function rotate(d) {
    const k = S.sel, t = k && sol().tiles[k];
    const next = (dir) => DIR_ORDER[(DIR_ORDER.indexOf(dir) + d + 4) % 4];
    if (t && t.dir) edit((s) => { s.tiles[k].dir = next(t.dir); });
    else { S.placeDir = next(S.placeDir); renderInspector(); draw(); }
  }
  // Picking a part from the palette clears the board selection, so the panel describes that part.
  function selectTool(t) {
    S.tool = S.tool === t ? null : t;
    S.sel = null;
    S.wireFrom = null;
    syncPalette();
    renderInspector();
    draw();
  }
  function toggleLink(from, to) {
    const exists = sol().links.some((l) => l.from === from && l.to === to);
    edit((s) => {
      if (exists) s.links = s.links.filter((l) => !(l.from === from && l.to === to));
      else s.links.push({ from, to, path: autoPath(unkey(from), unkey(to)) });
    });
    toast(exists ? 'Wire removed.' : 'Wired.');
  }
  function extendPath(path, c) {
    let guard = 64;
    while (guard-- > 0) {
      const last = path[path.length - 1];
      if (last.x === c.x && last.y === c.y) break;
      const n = last.x !== c.x ? { x: last.x + Math.sign(c.x - last.x), y: last.y } : { x: last.x, y: last.y + Math.sign(c.y - last.y) };
      const prev = path[path.length - 2];
      if (prev && prev.x === n.x && prev.y === n.y) path.pop(); else path.push(n);
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function canvasPt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function cellAtPt(p) {
    const x = Math.floor((p.x - geo.ox) / geo.s), y = Math.floor((p.y - geo.oy) / geo.s);
    return inBounds(x, y) ? { x, y } : null;
  }
  const cellFromEvent = (e) => cellAtPt(canvasPt(e));
  /* Clicking a sensor selects it and starts wiring from it. While wiring, clicking an
     actuator or pull emitter connects it (or disconnects it if already wired), clicking
     another sensor switches to it, and clicking the sensor again or an empty cell stops. */
  function clickCell(c) {
    const k = key(c.x, c.y), t = sol().tiles[k], kind = cellKind(c.x, c.y);
    const feedable = (t && isActuatorType(t.type)) || !!pullEmitterAt(k);
    if (S.wireFrom) {
      if (k === S.wireFrom) S.wireFrom = null;
      else if (feedable) toggleLink(S.wireFrom, k);
      else if (t && isSensorType(t.type)) { S.sel = k; S.wireFrom = k; }
      else if (t || kind === 'emitter') { S.wireFrom = null; S.sel = k; }
      else { S.wireFrom = null; S.sel = null; }
    } else if (t && isSensorType(t.type)) {
      S.sel = k; S.wireFrom = k; S.tool = null;
      syncPalette();
    } else if (t || kind === 'emitter') {
      S.sel = k;
    } else if (S.tool && buildable(c.x, c.y)) {
      placeTile(k, S.tool); S.sel = k;
    } else {
      S.sel = null;
      if (buildable(c.x, c.y)) toast('Drag a part onto the board, or pick one and click a cell.');
    }
    renderInspector();
    draw();
  }
  /* Route for a new wire. Parts in the same row or column get a U-shaped detour
     through the neighboring row or column, so the wire arcs beside the parts
     instead of running across them (or vanishing between neighbors). Others get an L. */
  function autoPath(a, b) {
    const L = level(), [ax, ay] = a, [bx, by] = b;
    const path = [{ x: ax, y: ay }];
    if (ay === by && ax !== bx) {
      const oy = ay + 1 < L.h ? ay + 1 : ay - 1;
      extendPath(path, { x: ax, y: oy });
      extendPath(path, { x: bx, y: oy });
    } else if (ax === bx && ay !== by) {
      const ox = ax + 1 < L.w ? ax + 1 : ax - 1;
      extendPath(path, { x: ox, y: ay });
      extendPath(path, { x: ox, y: by });
    }
    extendPath(path, { x: bx, y: by });
    return path.map((c) => [c.x, c.y]);
  }
  // Move a part. Its wires follow it, rerouted along a simple L.
  function moveTile(from, to) {
    edit((s) => {
      s.tiles[to] = s.tiles[from];
      delete s.tiles[from];
      s.links = s.links.map((l) => {
        if (l.from !== from && l.to !== from) return l;
        const nl = { from: l.from === from ? to : l.from, to: l.to === from ? to : l.to };
        nl.path = autoPath(unkey(nl.from), unkey(nl.to));
        return nl;
      });
    });
    if (S.wireFrom === from) S.wireFrom = to;
    S.sel = to;
    renderInspector();
    draw();
  }
  function dropPart(from, c) {
    if (!c) { removeTileAt(from); toast('Part removed. Ctrl+Z brings it back.'); return; }
    const to = key(c.x, c.y);
    if (to === from) { S.sel = from; renderInspector(); return; }
    if (sol().tiles[to]) { toast('That cell already has a part.'); return; }
    if (!buildable(c.x, c.y)) { toast('Parts only go on empty floor cells.'); return; }
    moveTile(from, to);
  }
  function dropNew(type, c) {
    if (!c) return;
    const k = key(c.x, c.y);
    if (sol().tiles[k]) { toast('That cell already has a part.'); return; }
    if (!buildable(c.x, c.y)) { toast('Parts only go on empty floor cells.'); return; }
    placeTile(k, type);
    S.sel = k;
    renderInspector();
    draw();
  }
  function updateCursor(c) {
    if (!c) { canvas.style.cursor = 'default'; return; }
    const k = key(c.x, c.y), t = sol().tiles[k];
    const feedable = (t && isActuatorType(t.type)) || !!pullEmitterAt(k);
    if (S.wireFrom && k !== S.wireFrom && feedable) { canvas.style.cursor = 'crosshair'; return; }
    canvas.style.cursor = t ? 'grab'
      : cellKind(c.x, c.y) === 'emitter' ? 'pointer'
        : S.tool && buildable(c.x, c.y) ? 'copy' : 'default';
  }

  /* Pointer on the board. Dragging a part moves it; a press without a drag is a click. */
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = canvasPt(e), c = cellAtPt(p);
    if (!c) { S.sel = null; S.wireFrom = null; renderInspector(); draw(); return; }
    const k = key(c.x, c.y), t = sol().tiles[k];
    const mode = t ? 'move' : 'click';
    S.drag = { mode, key: k, start: c, moved: false, lifted: false, x0: p.x, y0: p.y, px: p.x, py: p.y };
    if (mode === 'move') canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = canvasPt(e), c = cellAtPt(p), hk = c ? key(c.x, c.y) : null, d = S.drag;
    let dirty = false;
    if (d && d.mode !== 'new') {
      d.px = p.x; d.py = p.y;
      if (c && (c.x !== d.start.x || c.y !== d.start.y)) d.moved = true;
      if (!d.lifted && Math.hypot(p.x - d.x0, p.y - d.y0) > 6) d.lifted = true;
      if (d.mode === 'move' && d.lifted) dirty = true;
    }
    if (hk !== S.hover) { S.hover = hk; dirty = true; }
    if (!d) updateCursor(c);
    if (dirty) draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = S.drag;
    if (!d || d.mode === 'new') return;
    S.drag = null;
    const c = cellFromEvent(e);
    if (d.mode === 'move' && d.lifted) dropPart(d.key, c);
    else if (!d.moved && c) clickCell(c);
    updateCursor(c);
    draw();
  });
  canvas.addEventListener('pointercancel', () => { if (S.drag && S.drag.mode !== 'new') { S.drag = null; draw(); } });
  canvas.addEventListener('pointerleave', () => { if (!S.drag) { S.hover = null; draw(); } });

  /* Dragging a part from the palette onto the board. */
  let palDown = null, suppressClick = false;
  function partPointerDown(e, type) {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    e.preventDefault();
    palDown = { type, x: e.clientX, y: e.clientY };
  }
  document.addEventListener('pointermove', (e) => {
    if (palDown && !S.drag && Math.hypot(e.clientX - palDown.x, e.clientY - palDown.y) > 6) {
      S.drag = { mode: 'new', type: palDown.type, lifted: true };
      palDown = null;
      document.body.classList.add('dragging');
    }
    const d = S.drag;
    if (d && d.mode === 'new') {
      const p = canvasPt(e);
      d.px = p.x; d.py = p.y;
      draw();
    }
  });
  document.addEventListener('pointerup', (e) => {
    palDown = null;
    const d = S.drag;
    if (!d || d.mode !== 'new') return;
    S.drag = null;
    document.body.classList.remove('dragging');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    dropNew(d.type, cellFromEvent(e));
    draw();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const c = cellFromEvent(e);
    if (c) removeTileAt(key(c.x, c.y));
  });

  /* ---------- Playback ---------- */
  let lastT = null;
  function setPos(p) {
    S.pos = Math.max(0, Math.min(lastIdx(), p));
    updateLive();
    draw();
  }
  /* Each tick is two frames internally (blocks move, then signals settle). The player
     only ever steps and scrubs whole ticks: frame 2t is the settled board after tick t. */
  function stepBy(d) {
    S.playing = false;
    syncPlay();
    if (d > 0) {
      const before = Math.floor(S.pos + 1e-9);
      setPos(Math.min(lastIdx(), Math.floor(S.pos / 2 + 1e-9) * 2 + 2));
      crossFrames(before, Math.floor(S.pos + 1e-9));
    } else setPos(Math.max(0, Math.ceil(S.pos / 2 - 1e-9) * 2 - 2));
  }

  /* Sounds and the solve card fire as playback (or stepping) moves through frames,
     never while scrubbing, so the payoff arrives when you watch the machine work. */
  function frameSounds(i) {
    const fr = frames(), F = fr[i];
    if (!F) return;
    const syms = levelSymbols(level());
    if (F.beat === 'tick') {
      if (S.speed <= 2) Sound.tick();
      if (F.crash) {
        Sound.crash();
        if (!REDUCED) { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); }
        return;
      }
      (F.gone || []).forEach((g) => {
        if (g.how === 'port') Sound.note(syms.indexOf(g.sym));
        else if (g.how === 'drain') Sound.drain();
      });
      if (F.fused && F.fused.length) Sound.fuse();
      if (F.fail) Sound.fail();
    } else {
      const P = fr[i - 1];
      if (P && Object.keys(F.act).some((k) => !!F.act[k] !== !!P.act[k])) Sound.click();
      if (F.cleared && F.cleared.length) Sound.chord([...new Set(F.cleared.map((b) => syms.indexOf(b.sym)))]);
      if (F.fail) Sound.fail();
    }
  }
  function crossFrames(from, to) {
    for (let i = from + 1; i <= to; i++) frameSounds(i);
    if (to > from && to === lastIdx()) reachedEnd();
  }
  function reachedEnd() {
    if (cur().result.status !== 'win') return;
    Sound.win();
    const others = S.results.map((r, i) => ({ r, i })).filter((x) => x.r.result.status !== 'win');
    if (!others.length) showCelebration();
    else toast(`This test passes. Test ${others[0].i + 1} still fails.`);
  }

  function togglePlay() {
    hideCelebration();
    if (S.playing) S.playing = false;
    else {
      if (S.pos >= lastIdx()) S.pos = 0;
      S.playing = true;
      lastT = null;
      requestAnimationFrame(loop);
    }
    syncPlay();
  }
  function loop(now) {
    if (!S.playing) return;
    // The first frame's timestamp can predate the click, so start the clock there.
    if (lastT == null) lastT = now;
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    const before = Math.floor(S.pos + 1e-9);
    S.pos = Math.max(0, S.pos + dt * S.speed * 2);
    if (S.pos >= lastIdx()) { S.pos = lastIdx(); S.playing = false; syncPlay(); }
    crossFrames(before, Math.min(lastIdx(), Math.floor(S.pos + 1e-9)));
    updateLive();
    draw();
    if (S.playing) requestAnimationFrame(loop);
  }
  function syncPlay() {
    $('#playIcon').setAttribute('d', S.playing ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M5 3l8 5-8 5z');
    $('#bPlay').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  }
  function syncScrub() {
    const el = $('#scrub');
    el.max = String(Math.ceil(lastIdx() / 2));
    el.value = String(Math.ceil(S.pos / 2 - 1e-9));
  }
  function updateLive() {
    if (!S.results.length) return;
    const fi = Math.min(lastIdx(), Math.floor(S.pos + 1e-9));
    if (fi === S.lastFrame) return;
    S.lastFrame = fi;
    const F = frames()[fi], C = comp();
    $('#scrub').value = String(Math.ceil(fi / 2));
    $('#tnum').textContent = String(F.t);
    document.querySelectorAll('[data-emit]').forEach((el) => {
      const i = +el.dataset.emit, e = C.emitters[i], n = F.emit[i];
      el.querySelectorAll('.chip').forEach((chip, j) => {
        if (e.cycle) chip.classList.toggle('next', j === n % e.seq.length);
        else { chip.classList.toggle('used', j < n); chip.classList.toggle('next', j === n); }
      });
    });
    document.querySelectorAll('[data-port]').forEach((el) => {
      const i = +el.dataset.port, got = F.ports[i], p = C.ports[i];
      const failHere = F.fail && F.fail.cells.includes(key(p.x, p.y));
      el.querySelectorAll('.chip').forEach((chip, j) => {
        chip.classList.toggle('done', j < got);
        chip.classList.toggle('next', j === got && !failHere);
        chip.classList.toggle('bad', j === got && !!failHere);
      });
    });
    document.querySelectorAll('[data-plate]').forEach((el) => {
      const i = +el.dataset.plate;
      el.textContent = `${F.plates[i]} of ${C.plates[i].need} filled`;
    });
  }

  $('#bPlay').onclick = togglePlay;
  $('#bBack').onclick = () => stepBy(-1);
  $('#bFwd').onclick = () => stepBy(1);
  $('#bReset').onclick = () => { S.playing = false; syncPlay(); setPos(0); };
  $('#scrub').addEventListener('input', (e) => { S.playing = false; syncPlay(); setPos(Math.min(lastIdx(), 2 * +e.target.value)); });
  $('#speed').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-speed]');
    if (!b) return;
    S.speed = +b.dataset.speed;
    syncSpeed();
  });
  function syncSpeed() {
    document.querySelectorAll('#speed button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === S.speed)));
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest && e.target.closest('button')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1); }
    else if (e.key === 'Home') { e.preventDefault(); S.playing = false; syncPlay(); setPos(0); }
    else if (e.key === 'End') { e.preventDefault(); S.playing = false; syncPlay(); setPos(lastIdx()); }
    else if (e.key === 'r' || e.key === 'R') rotate(e.shiftKey ? -1 : 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel) { e.preventDefault(); removeTileAt(S.sel); } }
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'Escape') { hideCelebration(); S.tool = null; S.sel = null; S.wireFrom = null; syncPalette(); renderInspector(); draw(); }
    else if (/^[1-9]$/.test(e.key)) { const t = S.toolKeys[+e.key - 1]; if (t) selectTool(t); }
  });

  /* ---------- Panels ---------- */
  const chip = (c, extra) => `<span class="chip${extra ? ' ' + extra : ''}" style="background:${symColor(c)}">${esc(c)}</span>`;
  const CHECK = '<svg class="lvl-done" viewBox="0 0 16 16" aria-label="Solved"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STAR = '<svg class="lvl-star" viewBox="0 0 16 16" aria-label="Both targets hit"><path d="M8 1.6l1.95 4 4.4.62-3.18 3.1.75 4.38L8 11.64l-3.92 2.06.75-4.38-3.18-3.1 4.4-.62z" fill="currentColor"/></svg>';
  const hitBoth = (L, best) => !!best && best.cost <= L.par.cost && best.ticks <= L.par.ticks
    && (L.par.area == null || (best.area != null && best.area <= L.par.area));
  const groupOf = (L) => L.group || 'Routing';
  // Levels are grouped (Workshop first); numbering runs within each group.
  function levelLabel(i) {
    const L = LEVELS[i], same = LEVELS.filter((x) => groupOf(x) === groupOf(L));
    const n = same.indexOf(L) + 1;
    return { n, count: same.length, chip: groupOf(L) === 'Workshop' ? 'W' + n : String(n).padStart(2, '0') };
  }
  // Parts a level introduces: in its tools but in no earlier level's.
  function newPartsFor(i) {
    const seen = new Set();
    LEVELS.slice(0, i).forEach((L) => L.tools.forEach((t) => seen.add(t)));
    return TOOL_ORDER.filter((t) => LEVELS[i].tools.includes(t) && !seen.has(t));
  }

  function renderLevels() {
    const el = $('#levels');
    const chipFor = (L, i) => {
      const best = store.get('best.' + L.id, null), both = hitBoth(L, best);
      const mark = best ? (both ? STAR : CHECK) : '';
      const status = best ? (both ? ', every target hit' : ', solved') : '';
      const lab = levelLabel(i);
      return `<button class="lvl" data-i="${i}" title="${esc(L.name)}" aria-label="${groupOf(L)} ${lab.n}: ${esc(L.name)}${status}" aria-current="${i === S.levelIdx}">${lab.chip}${mark}</button>`;
    };
    const groups = ['Workshop', 'Routing'].map((g) => ({ g, items: LEVELS.map((L, i) => ({ L, i })).filter((x) => groupOf(x.L) === g) }))
      .filter((x) => x.items.length);
    el.innerHTML = groups.map(({ g, items }) => `
      <div class="lvl-group"><h3>${g === 'Workshop' ? 'Workshop <span class="exp">experiment</span>' : 'Routing'}</h3>
      <div class="lvl-grid">${items.map(({ L, i }) => chipFor(L, i)).join('')}</div></div>`).join('');
    el.querySelectorAll('.lvl').forEach((b) => { b.onclick = () => { if (+b.dataset.i !== S.levelIdx) loadLevel(+b.dataset.i); }; });
  }

  function emitterMeta(e) {
    const how = e.mode === 'pull' ? 'released by a lit wire' : `every ${e.period} ticks`;
    return `${how} · ${e.cycle ? 'repeats forever' : e.seq.length + ' blocks'}`;
  }
  function renderInfo() {
    const L = level(), C = comp();
    const goals = C.ports.map((p, i) => `
      <div class="io">
        <div class="io-head"><span class="io-id">${esc(p.id)}</span><span class="io-meta">wants these, in order</span></div>
        <div class="strip" data-port="${i}">${p.expect.map((c) => chip(c)).join('')}</div>
      </div>`).join('') + C.plates.map((p, i) => `
      <div class="io">
        <div class="io-head"><span class="io-id">${esc(p.id)}</span><span class="io-meta" data-plate="${i}">0 of ${p.need} filled</span></div>
        <div class="mini" style="grid-template-columns:repeat(${p.w}, 22px)">${p.pattern.flat().map((c) => chip(c)).join('')}</div>
      </div>`).join('');
    const lab = levelLabel(S.levelIdx);
    const inputs = C.emitters.length ? `
      <h2>Inputs</h2>
      ${C.emitters.map((e, i) => `
        <div class="io">
          <div class="io-head"><span class="io-id">${esc(e.id)}</span><span class="io-meta">${emitterMeta(e)}</span></div>
          <div class="strip" data-emit="${i}">${e.seq.map((c) => chip(c)).join('')}${e.cycle ? '<span class="repeat">↻</span>' : ''}</div>
        </div>`).join('')}` : `
      <h2>Sources</h2>
      <div class="io"><div class="strip">${(L.sources || []).map((c) => chip(c)).join('')}</div>
        <span class="io-meta">Place as many as you like, ${TILE_DEFS.source.cost} each</span></div>
      ${(L.recipes || []).length ? `<div style="height:14px"></div><h2>Recipes</h2>
      <div class="recipes">${L.recipes.map(([a, b, out]) => `<div class="recipe">${chip(a)}<span>+</span>${chip(b)}<span>→</span>${chip(out)}</div>`).join('')}</div>` : ''}`;
    $('#levelInfo').innerHTML = `
      <p class="eyebrow">${groupOf(L) === 'Workshop' ? 'Workshop' : 'Level'} ${lab.n} of ${lab.count}</p>
      <h1>${esc(L.name)}</h1>
      <p class="brief-text">${esc(L.brief)}</p>
      ${(() => { const np = newPartsFor(S.levelIdx); return np.length ? `<p class="newparts">New: ${np.map((t) => TILE_DEFS[t].name).join(', ')}</p>` : ''; })()}
      <div style="height:16px"></div>
      ${inputs}
      <div style="height:16px"></div>
      <h2>Goal</h2>
      ${goals}`;
    S.lastFrame = -1;
    updateLive();
  }

  function renderScore() {
    const L = level(), cost = solutionCost(sol());
    const allWin = S.results.every((r) => r.result.status === 'win');
    const ticks = allWin ? Math.max(...S.results.map((r) => r.result.t)) : null;
    const best = store.get('best.' + L.id, null);
    const hasHist = (S.history[L.id] || []).length > 0;
    const okC = !!best && best.cost <= L.par.cost, okT = !!best && best.ticks <= L.par.ticks;
    const hasArea = L.par.area != null;
    const okA = hasArea && !!best && best.area != null && best.area <= L.par.area;
    const area = allWin ? Math.max(...S.results.map((r) => r.result.area)) : null;
    const tick = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $('#scoreBox').innerHTML = `
      <h2>This machine</h2>
      <div class="score${hasArea ? ' three' : ''}">
        <div class="stat"><span class="stat-k">Cost</span><span class="stat-v">${cost}</span></div>
        <div class="stat"><span class="stat-k">Ticks</span><span class="stat-v">${ticks == null ? '—' : ticks}</span></div>
        ${hasArea ? `<div class="stat" title="Open cells your machine uses: parts plus every cell a block passes through"><span class="stat-k">Area</span><span class="stat-v">${area == null ? '—' : area}</span></div>` : ''}
      </div>
      <div class="targets" title="The best machines found so far. Each target may come from a different machine.">
        <span class="tlabel">Targets</span>
        <span class="pill${okC ? ' ok' : ''}">${okC ? tick : ''}Cost ${L.par.cost}</span>
        <span class="pill${okT ? ' ok' : ''}">${okT ? tick : ''}${L.par.ticks} ticks</span>
        ${hasArea ? `<span class="pill${okA ? ' ok' : ''}">${okA ? tick : ''}Area ${L.par.area}</span>` : ''}
      </div>
      <div class="best">${best ? `Your best: cost ${best.cost} · ${best.ticks} ticks${hasArea && best.area != null ? ` · area ${best.area}` : ''}` : 'Not solved yet'}</div>
      <div style="height:12px"></div>
      <div class="actions">
        <button class="btn" id="bUndo" ${hasHist ? '' : 'disabled'}>Undo</button>
        <button class="btn danger" id="bClear" ${Object.keys(sol().tiles).length ? '' : 'disabled'}>Clear board</button>
      </div>
      <button class="linkbtn quiet" id="bRef">Stuck? Show a working machine</button>`;
    $('#bUndo').onclick = undo;
    $('#bClear').onclick = () => { edit((s) => { s.tiles = {}; s.links = []; }); S.sel = null; renderInspector(); toast('Board cleared. Undo brings it back.'); };
    $('#bRef').onclick = () => { edit((s) => { const r = JSON.parse(JSON.stringify(L.ref)); s.tiles = r.tiles; s.links = r.links; }); S.sel = null; renderInspector(); toast('Loaded a working machine. It isn’t the best one. Undo brings yours back.'); };
  }

  /* ---------- Solve card ---------- */
  function hideCelebration() { const el = document.getElementById('celebrate'); if (el) el.hidden = true; }
  function showCelebration() {
    const L = level(), i = S.levelIdx, cost = solutionCost(sol());
    const ticks = Math.max(...S.results.map((r) => r.result.t));
    const area = Math.max(...S.results.map((r) => r.result.area));
    const best = store.get('best.' + L.id, null) || { cost, ticks, area };
    const imp = S.improved || {};
    const okC = best.cost <= L.par.cost, okT = best.ticks <= L.par.ticks;
    const hasArea = L.par.area != null;
    const row = (k, v, target, isNew) => {
      const met = v <= target;
      const note = met ? (v < target ? `beats the target of ${target}` : 'hits the target') : `target is ${target}`;
      return `<div class="cel-row"><span class="cel-k">${k}</span><span class="cel-v">${v}</span><span class="cel-t${met ? ' ok' : ''}">${note}</span>${isNew ? '<span class="cel-new">New best</span>' : '<span></span>'}</div>`;
    };
    const marks = [['cost', okC], ['tick', okT]].concat(hasArea ? [['area', best.area != null && best.area <= L.par.area]] : []);
    const hit = marks.filter((m) => m[1]).map((m) => m[0]), open = marks.filter((m) => !m[1]).map((m) => m[0]);
    const list = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const sub = !open.length ? 'You’ve hit every target on this level.'
      : hit.length ? `${cap(list(hit))} target${hit.length > 1 ? 's' : ''} hit. Still open: ${list(open)}.`
        : 'It works. The targets show what’s possible.';
    const next = LEVELS[i + 1];
    $('#celEyebrow').textContent = `${groupOf(L) === 'Workshop' ? 'Workshop' : 'Level'} ${levelLabel(i).n} · ${L.name}`;
    $('#celSub').textContent = next ? sub : `${sub} That’s every level.`;
    $('#celRows').innerHTML = row('Cost', cost, L.par.cost, imp.cost) + row('Ticks', ticks, L.par.ticks, imp.ticks)
      + (hasArea ? row('Area', area, L.par.area, imp.area) : '');
    const nb = $('#celNext');
    nb.hidden = !next;
    if (next) nb.textContent = `Next: ${next.name}`;
    $('#celebrate').hidden = false;
    (next ? nb : $('#celStay')).focus({ preventScroll: true });
  }
  $('#celStay').onclick = hideCelebration;
  $('#celNext').onclick = () => { if (LEVELS[S.levelIdx + 1]) loadLevel(S.levelIdx + 1); };
  $('#celebrate').addEventListener('click', (e) => { if (e.target.id === 'celebrate') hideCelebration(); });

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    syncMute();
    if (!Sound.muted) Sound.click();
  }
  function syncMute() {
    $('#sndOn').toggleAttribute('hidden', Sound.muted);
    $('#sndOff').toggleAttribute('hidden', !Sound.muted);
    const b = $('#bMute');
    b.setAttribute('aria-label', Sound.muted ? 'Turn sound on' : 'Mute sound');
    b.title = Sound.muted ? 'Sound off (M)' : 'Sound on (M)';
  }
  $('#bMute').onclick = toggleMute;
  // Browsers only allow audio after a gesture, so the first press anywhere wakes it.
  document.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('keydown', () => Sound.unlock());

  function renderResult() {
    const tests = S.results;
    const testsEl = $('#tests');
    testsEl.innerHTML = tests.length > 1 ? tests.map((r, i) => `<button class="test" data-t="${i}" aria-pressed="${i === S.testIdx}"><span class="dot ${r.result.status === 'win' ? 'ok' : 'bad'}"></span>Test ${i + 1}</button>`).join('') : '';
    testsEl.querySelectorAll('.test').forEach((b) => {
      b.onclick = () => {
        S.testIdx = +b.dataset.t; S.pos = 0; S.playing = false; syncPlay();
        renderInfo(); resim(); draw();
      };
    });
    const r = cur().result, el = $('#result');
    const allWin = tests.every((x) => x.result.status === 'win');
    const win = r.status === 'win';
    let msg = r.msg;
    if (win && allWin && tests.length > 1) msg = `All ${tests.length} tests pass · slowest takes ${Math.max(...tests.map((x) => x.result.t))} ticks`;
    el.className = 'result ' + (win ? 'ok' : 'bad');
    el.innerHTML = `<span class="dot ${win ? 'ok' : 'bad'}"></span><span class="result-msg">${esc(msg)}</span>${win ? '' : '<button class="linkbtn" id="jump">Show me</button>'}`;
    const j = $('#jump');
    if (j) j.onclick = () => { S.playing = false; syncPlay(); setPos(lastIdx()); };
  }

  function drawIcon(cv, type, size, props) {
    const d = window.devicePixelRatio || 1;
    cv.width = Math.round(size * d); cv.height = Math.round(size * d);
    const c = cv.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, size, size);
    const t = Object.assign(defaultTile(type), props || {});
    if (!props && t.dir) t.dir = 'E';
    drawTile(c, t, size / 2, size / 2, size * 0.98, { pip: 0 });
  }
  function renderPalette() {
    const L = level(), el = $('#palette');
    const groups = [['actuator', 'Actuators'], ['static', 'Static tiles'], ['sensor', 'Sensors']];
    S.toolKeys = [];
    let n = 0;
    const fresh = new Set(newPartsFor(S.levelIdx));
    el.innerHTML = '<h2>Parts</h2>' + groups.map(([fam, label]) => {
      const ts = TOOL_ORDER.filter((t) => L.tools.includes(t) && TILE_DEFS[t].family === fam);
      if (!ts.length) return '';
      return `<div class="pgroup"><h3>${label}</h3><div class="pgrid">${ts.map((t) => {
        n++; S.toolKeys.push(t);
        return `<button class="part" data-tool="${t}" aria-pressed="false" title="${esc(TILE_DEFS[t].desc)} Cost ${TILE_DEFS[t].cost}."><canvas></canvas><span class="pname">${TILE_DEFS[t].name}</span><span class="pkey">${n}</span>${fresh.has(t) ? '<span class="pnew">New</span>' : ''}</button>`;
      }).join('')}</div></div>`;
    }).join('');
    el.querySelectorAll('.part').forEach((b) => {
      const type = b.dataset.tool;
      drawIcon(b.querySelector('canvas'), type, 32);
      b.addEventListener('pointerdown', (e) => partPointerDown(e, type));
      b.onclick = () => { if (!suppressClick) selectTool(type); };
    });
    syncPalette();
  }
  function syncPalette() {
    document.querySelectorAll('.part').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
  }

  function renderInspector() {
    const el = $('#inspector'), s = sol(), k = S.sel;
    const t = k && s.tiles[k];
    const em = k && !t ? comp().emitters.find((e) => key(e.x, e.y) === k) : null;
    if (t) {
      const def = TILE_DEFS[t.type], fam = def.family;
      const outs = s.links.filter((l) => l.from === k).length, ins = s.links.filter((l) => l.to === k).length;
      const syms = levelSymbols(level());
      let fields = '';
      if (t.dir) fields += `<div class="field"><span class="flabel">Heading</span><div class="seg" data-prop="dir">${DIR_ORDER.map((d) => `<button data-v="${d}" aria-pressed="${t.dir === d}" aria-label="${d}">${ARROWS[d]}</button>`).join('')}</div></div>`;
      const symChoices = t.type === 'source' ? (level().sources || []) : syms;
      if (t.sym != null) fields += `<div class="field"><span class="flabel">Symbol</span><div class="seg" data-prop="sym">${symChoices.map((c) => `<button class="chip-btn" style="background:${symColor(c)}" data-v="${esc(c)}" aria-pressed="${t.sym === c}">${esc(c)}</button>`).join('')}</div></div>`;
      if (t.type === 'join') {
        fields += `<div class="field"><span class="flabel">Makes</span><div class="seg" data-prop="out">${(level().recipes || []).map(([a, b, out]) => `<button data-v="${esc(out)}" aria-pressed="${t.out === out}">${esc(a)} + ${esc(b)} → ${esc(out)}</button>`).join('')}</div></div>`;
      }
      if (t.type === 'clock') {
        const kk = t.k || 0;
        fields += `<div class="field"><span class="flabel">At tick 0</span><div class="seg" data-prop="k"><button data-v="0" aria-pressed="${kk === 0}">Starts lit</button><button data-v="1" aria-pressed="${kk === 1}">Starts dark</button></div></div>`;
      }
      if (fam === 'sensor') {
        const wiring = S.wireFrom === k;
        const msg = wiring
          ? 'Wiring from this sensor. Click an actuator or pull emitter to connect it, or a connected one to disconnect it. Click an empty cell to stop.'
          : `${outs ? `${outs} wire${outs > 1 ? 's' : ''} out. ` : ''}Click this sensor again to wire it.`;
        fields += `<div class="wirebox${wiring ? ' on' : ''}"><span>${msg}</span>${outs ? '<button class="btn quiet" id="unwire">Remove its wires</button>' : ''}</div>`;
      }
      if (fam === 'actuator') fields += `<div class="wires"><span>${ins ? `${ins} wire${ins > 1 ? 's' : ''} in, so it acts only while lit.` : 'No wires, so it is always on.'}</span>${ins ? '<button class="btn quiet" id="unwire">Remove wires</button>' : ''}</div>`;
      el.innerHTML = `
        <h2>Selected</h2>
        <div class="insp-head"><canvas id="inspIcon"></canvas><div><div class="insp-name">${def.name}</div><div class="insp-fam">${fam === 'static' ? 'Static tile' : fam === 'sensor' ? 'Sensor' : 'Actuator'} · cost ${def.cost}</div></div></div>
        <p class="insp-desc">${esc(def.desc)}</p>
        <div class="fields">${fields}<button class="btn danger" id="delTile">Remove part</button></div>`;
      drawIcon($('#inspIcon'), t.type, 40, t);
      el.querySelectorAll('.seg[data-prop] button').forEach((b) => {
        b.onclick = () => {
          const prop = b.parentElement.dataset.prop;
          const v = prop === 'k' ? +b.dataset.v : b.dataset.v;
          edit((so) => { so.tiles[k][prop] = v; });
          if (prop === 'dir') S.placeDir = v;
        };
      });
      const uw = $('#unwire');
      if (uw) uw.onclick = () => edit((so) => { so.links = so.links.filter((l) => l.from !== k && l.to !== k); });
      $('#delTile').onclick = () => removeTileAt(k);
    } else if (em) {
      const ins = s.links.filter((l) => l.to === k).length;
      el.innerHTML = `
        <h2>Selected</h2>
        <div class="insp-name">Emitter ${esc(em.id)}</div>
        <p class="insp-desc">${em.mode === 'pull'
          ? 'Releases its next block on each tick its wire is lit, if its cell has room. To wire it, click a sensor, then click this emitter.'
          : `Pushes a block every ${em.period} ticks whether or not there is room. If its cell is still occupied, that's a crash.`}</p>
        ${em.mode === 'pull' ? `<div class="fields"><div class="wires"><span>${ins ? `${ins} wire${ins > 1 ? 's' : ''} in` : 'No wires yet'}</span>${ins ? '<button class="btn quiet" id="unwire">Remove wires</button>' : ''}</div></div>` : ''}`;
      const uw = $('#unwire');
      if (uw) uw.onclick = () => edit((so) => { so.links = so.links.filter((l) => l.to !== k); });
    } else if (S.tool) {
      const def = TILE_DEFS[S.tool];
      el.innerHTML = `
        <h2>Placing</h2>
        <div class="insp-head"><canvas id="inspIcon"></canvas><div><div class="insp-name">${def.name}</div><div class="insp-fam">cost ${def.cost}</div></div></div>
        <p class="insp-desc">${esc(def.desc)}</p>
        <p class="hint" style="margin-top:8px">Click an empty cell, or drag the part onto the board.${['filter', 'redirect', 'source', 'join'].includes(S.tool) ? ` It will face ${ARROWS[S.placeDir]}. Press <kbd>R</kbd> to rotate.` : ''} <kbd>Esc</kbd> puts the part down.</p>`;
      drawIcon($('#inspIcon'), S.tool, 40, ['filter', 'redirect', 'source', 'join'].includes(S.tool) ? { dir: S.placeDir } : null);
    } else {
      el.innerHTML = '<h2>Selected</h2><p class="hint">Nothing selected. Click a part on the board to edit it, or click a sensor to start wiring.</p>';
    }
    // keep the Undo/Clear buttons in step with the board
    const u = $('#bUndo'); if (u) u.disabled = !(S.history[level().id] || []).length;
    const cl = $('#bClear'); if (cl) cl.disabled = !Object.keys(sol().tiles).length;
  }

  /* ---------- Boot ---------- */
  function start(data) {
    readColors();
    S.sols = {};
    if (data && data.sols) for (const id in data.sols) S.sols[id] = sanitizeSol(data.sols[id]);
    const saved = data && Number.isInteger(data.levelIdx) ? data.levelIdx : store.get('level', 0);
    syncSpeed();
    syncMute();
    new ResizeObserver(() => fit()).observe(wrap);
    loadLevel(Math.min(Math.max(0, saved | 0), LEVELS.length - 1));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderPalette(); renderInspector(); draw(); });
  }
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    window.claude.hot.snapshot(() => ({ levelIdx: S.levelIdx, sols: S.sols }));
  }
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
  else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
})();
