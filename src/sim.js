'use strict';
/* ============================================================
   Escapement simulation. Pure and deterministic:
   board state in, next state out. Each tick has two beats:
     tick  (move beat)   blocks slide one cell; nothing electrical changes
     tock  (signal beat) sensors read, wires carry, actuators snap
   An actuator's state during a move is whatever the previous tock set.
   ============================================================ */

const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIR_ORDER = ['N', 'E', 'S', 'W'];
const key = (x, y) => x + ',' + y;
const unkey = (k) => k.split(',').map(Number);

const TILE_DEFS = {
  source:   { family: 'actuator', name: 'Source',   cost: 6, desc: 'Releases a block of its symbol each tick its exit is clear. Once wired, it only releases while lit. A blocked source waits; it never crashes.' },
  join:     { family: 'static',   name: 'Join',     cost: 3, desc: 'Two blocks entering on the same tick that match its recipe fuse into the product, which leaves along its arrow. A lone block passes straight through untouched.' },
  filter:   { family: 'static',   name: 'Filter',   cost: 3, desc: 'Blocks with this symbol take this heading. Others pass straight through.' },
  drain:    { family: 'static',   name: 'Drain',    cost: 2, desc: 'Removes any block that enters.' },
  presence: { family: 'sensor',   name: 'Presence', cost: 2, desc: 'On while any block sits on it.' },
  kind:     { family: 'sensor',   name: 'Kind',     cost: 3, desc: 'On while a block with this symbol sits on it.' },
  clock:    { family: 'sensor',   name: 'Clock',    cost: 2, desc: 'Alternates every tick: lit, dark, lit, dark.' },
  toggle:   { family: 'sensor',   name: 'Toggle',   cost: 2, desc: 'Flips between dark and lit each time a block arrives. Starts dark.' },
  redirect: { family: 'actuator', name: 'Redirect', cost: 2, desc: 'Blocks entering take this heading. Once wired, it only turns them while lit; dark, they pass straight through.' },
  gate:     { family: 'actuator', name: 'Gate',     cost: 2, desc: 'The block on it cannot leave. Once wired, it only holds while lit.' },
};
// Actuators with no wire are always on: an unwired redirect is a plain turn, an unwired gate a stop.
const TOOL_ORDER = ['source', 'redirect', 'gate', 'join', 'filter', 'drain', 'presence', 'kind', 'clock', 'toggle'];
const isSensorType = (t) => !!TILE_DEFS[t] && TILE_DEFS[t].family === 'sensor';
const isActuatorType = (t) => !!TILE_DEFS[t] && TILE_DEFS[t].family === 'actuator';

/* ---------- Levels ----------
   Each level has a reference machine (`ref`, shown on request: a working solution,
   not necessarily the best) and targets (`par`) for cost and ticks. The targets
   are the best machines found so far, and may come from two different machines,
   so meeting both at once can be harder than meeting each. test.js proves every
   reference and target machine. */
const R = (dir) => ({ type: 'redirect', dir });
const LEVELS = [
  {
    id: 'first-turn', name: 'First Turn', w: 7, h: 5,
    brief: 'Blocks slide one cell per tick until something stops them. A redirect turns any block that enters it to face its arrow. Get all four blocks to the output, then press Space to watch it run.',
    tools: ['redirect'],
    walls: [[4, 0], [4, 1], [4, 2], [4, 3]],
    emitters: [{ id: 'E1', x: 0, y: 1, dir: 'E', period: 2, seq: 'AAAA' }],
    ports: [{ id: 'O1', x: 6, y: 4, expect: 'AAAA' }],
    par: { cost: 4, ticks: 16 },
    ref: { tiles: { '3,1': R('S'), '3,4': R('E') }, links: [] },
  },
  {
    id: 'sorting-office', name: 'Sorting Office', w: 8, h: 6,
    brief: 'A filter only turns blocks that carry its symbol. A drain swallows whatever enters it. Send A and B to their outputs and get rid of every C. One machine has to pass both tests.',
    tools: ['redirect', 'filter', 'drain'],
    emitters: [{ id: 'E1', x: 0, y: 2, dir: 'E', period: 2, seq: 'ABCABCAB' }],
    ports: [{ id: 'OA', x: 2, y: 0, expect: 'AAA' }, { id: 'OB', x: 6, y: 5, expect: 'BBB' }],
    tests: [{}, { emit: { E1: 'BACCABBA' } }],
    par: { cost: 8, ticks: 24 },
    ref: {
      tiles: {
        '2,2': { type: 'filter', dir: 'N', sym: 'A' }, '4,2': { type: 'filter', dir: 'S', sym: 'C' },
        '4,3': { type: 'drain' }, '6,2': R('S'),
      },
      links: [],
    },
  },
  {
    id: 'two-rows', name: 'Two Rows', w: 8, h: 6,
    brief: 'Blocks that reach a plate slide until they hit its far wall, then stay put. Fill the plate with the picture shown. When it matches, it clears for another round.',
    tools: ['redirect', 'filter'],
    emitters: [{ id: 'E1', x: 0, y: 2, dir: 'E', period: 2, seq: 'AB', cycle: true }],
    plates: [{ id: 'P1', x: 5, y: 1, w: 3, h: 2, pattern: ['AAA', 'BBB'], need: 2 }],
    par: { cost: 5, ticks: 28 },
    ref: { tiles: { '3,2': { type: 'filter', dir: 'N', sym: 'A' }, '3,1': R('E') }, links: [] },
  },
  {
    id: 'even-split', name: 'Even Split', w: 8, h: 6,
    brief: 'Every block looks the same, so no filter can tell them apart, and each output wants exactly three. To wire a sensor, click it, then click a redirect. Once wired, a redirect only turns blocks while its wire is lit.',
    tools: ['redirect', 'presence', 'clock', 'toggle'],
    emitters: [{ id: 'E1', x: 0, y: 2, dir: 'E', period: 2, seq: 'AAAAAA' }],
    ports: [{ id: 'O1', x: 4, y: 0, expect: 'AAA' }, { id: 'O2', x: 6, y: 5, expect: 'AAA' }],
    par: { cost: 6, ticks: 20 },
    ref: {
      tiles: { '3,2': { type: 'toggle' }, '4,2': R('N'), '6,2': R('S') },
      links: [{ from: '3,2', to: '4,2', path: [[3, 2], [3, 3], [4, 3], [4, 2]] }],
    },
  },
  {
    id: 'on-cue', name: 'On Cue', w: 8, h: 6,
    brief: 'These emitters wait to be told. On each tick their wire is lit, they release one block. Interleave A and B at the output.',
    tools: ['redirect', 'presence', 'kind', 'clock'],
    emitters: [
      { id: 'EA', x: 2, y: 0, dir: 'S', mode: 'pull', seq: 'AAAA' },
      { id: 'EB', x: 0, y: 3, dir: 'E', mode: 'pull', seq: 'BBBB' },
    ],
    ports: [{ id: 'O1', x: 7, y: 3, expect: 'ABABABAB' }],
    par: { cost: 6, ticks: 16 },
    ref: {
      tiles: { '2,3': R('E'), '5,0': { type: 'clock', k: 0 }, '2,1': { type: 'presence' } },
      links: [
        { from: '5,0', to: '2,0', path: [[5, 0], [4, 0], [3, 0], [2, 0]] },
        { from: '2,1', to: '0,3', path: [[2, 1], [1, 1], [0, 1], [0, 2], [0, 3]] },
      ],
    },
  },
  {
    id: 'zipper', name: 'Zipper', w: 8, h: 6,
    brief: 'Both emitters fire on the same beat, and the two lanes meet at a single cell. Get them to take turns.',
    tools: ['redirect', 'gate', 'presence', 'kind', 'clock'],
    emitters: [
      { id: 'EA', x: 0, y: 3, dir: 'E', period: 2, seq: 'AAAA' },
      { id: 'EB', x: 3, y: 0, dir: 'S', period: 2, seq: 'BBBB' },
    ],
    ports: [{ id: 'O1', x: 7, y: 3, expect: 'ABABABAB' }],
    par: { cost: 6, ticks: 15 },
    ref: {
      tiles: { '3,3': R('E'), '2,3': { type: 'presence' }, '3,2': { type: 'gate' } },
      links: [{ from: '2,3', to: '3,2', path: [[2, 3], [2, 2], [3, 2]] }],
    },
  },
  {
    id: 'swap-pairs', name: 'Swap Pairs', w: 9, h: 6,
    brief: 'Every A arrives just ahead of its B. The output wants each pair the other way around.',
    tools: ['redirect', 'gate', 'filter', 'presence', 'kind', 'clock'],
    emitters: [{ id: 'E1', x: 0, y: 3, dir: 'E', period: 2, seq: 'ABABABAB' }],
    ports: [{ id: 'O1', x: 8, y: 3, expect: 'BABABABA' }],
    par: { cost: 9, ticks: 24 },
    ref: {
      tiles: {
        '2,3': { type: 'filter', dir: 'N', sym: 'A' }, '2,2': R('E'), '5,2': { type: 'gate' }, '6,2': R('S'), '6,3': R('E'),
        '4,3': { type: 'presence' },
      },
      links: [{ from: '4,3', to: '5,2', path: [[4, 3], [4, 2], [5, 2]] }],
    },
  },
  {
    id: 'crossroads', name: 'Crossroads', w: 9, h: 7,
    brief: 'Two roads cross in the middle of town, and the traffic never settles into a rhythm. Get every car home.',
    tools: ['redirect', 'gate', 'presence', 'kind', 'clock'],
    walls: [
      [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [6, 0], [7, 0], [8, 0], [6, 1], [7, 1], [8, 1],
      [0, 5], [1, 5], [2, 5], [0, 6], [1, 6], [2, 6], [6, 5], [7, 5], [8, 5], [6, 6], [7, 6], [8, 6],
    ],
    emitters: [
      { id: 'EA', x: 0, y: 3, dir: 'E', period: 3, seq: 'AAAAAAAAAA' },
      { id: 'EB', x: 4, y: 6, dir: 'N', period: 5, seq: 'BBBBBB' },
    ],
    ports: [{ id: 'OA', x: 8, y: 3, expect: 'AAAAAAAAAA' }, { id: 'OB', x: 4, y: 0, expect: 'BBBBBB' }],
    par: { cost: 4, ticks: 36 },
    ref: {
      tiles: { '3,3': { type: 'presence' }, '4,4': { type: 'gate' } },
      links: [{ from: '3,3', to: '4,4', path: [[3, 3], [3, 4], [4, 4]] }],
    },
  },
  {
    id: 'four-ways', name: 'Four Ways', w: 9, h: 7,
    brief: 'Eight identical blocks, four outputs, two each. A toggle only knows odd from even.',
    tools: ['redirect', 'gate', 'filter', 'drain', 'presence', 'kind', 'clock', 'toggle'],
    emitters: [{ id: 'E1', x: 0, y: 3, dir: 'E', period: 2, seq: 'AAAAAAAA' }],
    ports: [
      { id: 'O1', x: 3, y: 0, expect: 'AA' }, { id: 'O2', x: 0, y: 1, expect: 'AA' },
      { id: 'O3', x: 8, y: 3, expect: 'AA' }, { id: 'O4', x: 5, y: 6, expect: 'AA' },
    ],
    par: { cost: 10, ticks: 23 },
    ref: {
      tiles: {
        '2,3': { type: 'toggle' }, '3,3': R('N'),
        '3,2': { type: 'toggle' }, '3,1': R('W'),
        '4,3': { type: 'toggle' }, '5,3': R('S'),
      },
      links: [
        { from: '2,3', to: '3,3', path: [[2, 3], [2, 4], [3, 4], [3, 3]] },
        { from: '3,2', to: '3,1', path: [[3, 2], [4, 2], [4, 1], [3, 1]] },
        { from: '4,3', to: '5,3', path: [[4, 3], [4, 4], [5, 4], [5, 3]] },
      ],
    },
  },
  {
    id: 'checkerboard', name: 'Checkerboard', w: 9, h: 7,
    brief: 'Columns fill from the bottom up. Lay the checkerboard twice. This one takes some planning.',
    tools: ['redirect', 'gate', 'filter', 'drain', 'presence', 'kind', 'clock', 'toggle'],
    emitters: [{ id: 'E1', x: 0, y: 1, dir: 'E', period: 2, seq: 'AB', cycle: true }],
    plates: [{ id: 'P1', x: 6, y: 5, w: 2, h: 2, pattern: ['AB', 'BA'], need: 2 }],
    par: { cost: 19, ticks: 26 },
    ref: {
      tiles: {
        '2,1': { type: 'filter', dir: 'S', sym: 'A' }, '2,2': { type: 'toggle' }, '2,3': R('E'), '2,4': R('E'),
        '5,4': R('E'), '6,4': R('S'), '7,3': R('S'), '4,1': { type: 'toggle' }, '5,1': R('S'), '7,1': R('S'),
      },
      links: [
        { from: '2,2', to: '2,3', path: [[2, 2], [1, 2], [1, 3], [2, 3]] },
        { from: '4,1', to: '5,1', path: [[4, 1], [4, 0], [5, 0], [5, 1]] },
      ],
    },
  },

  /* ---------- Workshop: construction levels (experiment) ----------
     Nothing is placed for you except the output. You place the sources, so all
     timing is your own, and joins turn ingredients into products. Area (open
     cells the machine uses) is a third score. */
  {
    id: 'first-join', name: 'First Join', group: 'Workshop', w: 12, h: 8,
    brief: 'Nothing is placed for you this time. Put down sources wherever you like, then send an A and a B into a join on the same tick to make a C. The output wants six.',
    tools: ['source', 'join', 'redirect'],
    sources: ['A', 'B'], recipes: [['A', 'B', 'C']],
    walls: [[8, 2], [9, 2], [10, 2], [8, 4], [9, 4], [10, 4]],
    ports: [{ id: 'O1', x: 11, y: 3, expect: 'CCCCCC' }],
    par: { cost: 15, ticks: 11, area: 6 },
    ref: { tiles: { '7,3': { type: 'join', out: 'C', dir: 'E' }, '6,3': { type: 'source', sym: 'A', dir: 'E' }, '7,2': { type: 'source', sym: 'B', dir: 'S' } }, links: [] },
  },
  {
    id: 'double-up', name: 'Double Up', group: 'Workshop', w: 14, h: 9,
    brief: 'A D takes two Cs arriving together. Sources are expensive.',
    tools: ['source', 'join', 'redirect', 'gate', 'filter', 'drain', 'presence', 'kind', 'toggle'],
    sources: ['A', 'B'], recipes: [['A', 'B', 'C'], ['C', 'C', 'D']],
    ports: [{ id: 'O1', x: 13, y: 4, expect: 'DDDD' }],
    par: { cost: 30, ticks: 7, area: 7 },
    ref: {
      tiles: {
        '12,4': { type: 'join', out: 'D', dir: 'E' },
        '11,4': { type: 'join', out: 'C', dir: 'E' }, '10,4': { type: 'source', sym: 'A', dir: 'E' }, '11,3': { type: 'source', sym: 'B', dir: 'S' },
        '12,5': { type: 'join', out: 'C', dir: 'N' }, '11,5': { type: 'source', sym: 'A', dir: 'E' }, '12,6': { type: 'source', sym: 'B', dir: 'N' },
      },
      links: [],
    },
  },
  {
    id: 'bakery', name: 'Bakery', group: 'Workshop', w: 14, h: 9,
    brief: 'Fill the tray: Cs down the left, Ds down the right, twice.',
    tools: ['source', 'join', 'redirect', 'gate', 'filter', 'drain', 'presence', 'kind', 'toggle'],
    sources: ['A', 'B'], recipes: [['A', 'B', 'C'], ['C', 'A', 'D']],
    plates: [{ id: 'P1', x: 11, y: 6, w: 2, h: 2, pattern: ['CD', 'CD'], need: 2 }],
    par: { cost: 36, ticks: 9, area: 14 },
    ref: {
      tiles: {
        '11,3': { type: 'join', out: 'C', dir: 'S' }, '10,3': { type: 'source', sym: 'A', dir: 'E' }, '11,2': { type: 'source', sym: 'B', dir: 'S' },
        '12,2': { type: 'join', out: 'C', dir: 'S' }, '12,1': { type: 'source', sym: 'B', dir: 'S' }, '13,2': { type: 'source', sym: 'A', dir: 'W' },
        '12,4': { type: 'join', out: 'D', dir: 'S' }, '13,6': { type: 'source', sym: 'A', dir: 'N' }, '13,4': R('W'),
      },
      links: [],
    },
  },
];

/* ---------- Level helpers ---------- */
function levelTests(level) {
  return level.tests && level.tests.length ? level.tests : [{}];
}

function compileLevel(level, test) {
  test = test || {};
  const walls = new Set((level.walls || []).map(([x, y]) => key(x, y)));
  const emitters = (level.emitters || []).map((e) => Object.assign(
    { period: 2, phase: 0, mode: 'push', cycle: false }, e,
    { seq: Array.from((test.emit && test.emit[e.id]) || e.seq) }));
  const ports = (level.ports || []).map((p) => Object.assign({}, p,
    { expect: Array.from((test.expect && test.expect[p.id]) || p.expect) }));
  const plates = (level.plates || []).map((p) => Object.assign({}, p,
    { pattern: p.pattern.map((r) => Array.from(r)) }));
  const emitAt = new Map(), portAt = new Map(), plateAt = new Map();
  emitters.forEach((e, i) => emitAt.set(key(e.x, e.y), i));
  ports.forEach((p, i) => portAt.set(key(p.x, p.y), i));
  plates.forEach((p, i) => {
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) {
      plateAt.set(key(p.x + dx, p.y + dy), { i, sym: p.pattern[dy][dx] });
    }
  });
  const recipes = (level.recipes || []).map(([a, b, out]) => ({ a, b, out }));
  return { W: level.w, H: level.h, walls, emitters, ports, plates, emitAt, portAt, plateAt, recipes, sources: level.sources || [] };
}

function validLinks(C, sol) {
  return (sol.links || []).filter((l) => {
    const a = sol.tiles[l.from], b = sol.tiles[l.to];
    if (!a || !isSensorType(a.type)) return false;
    if (b && isActuatorType(b.type)) return true;
    const ei = C.emitAt.get(l.to);
    return ei !== undefined && C.emitters[ei].mode === 'pull';
  });
}

function solutionCost(sol) {
  return Object.values(sol.tiles || {}).reduce((a, t) => a + TILE_DEFS[t.type].cost, 0);
}

/* ---------- Simulation ---------- */
function simulate(level, testIndex, sol, limitOverride) {
  const test = levelTests(level)[testIndex] || {};
  const C = compileLevel(level, test);
  const limit = limitOverride || level.limit || 300;
  const tiles = sol.tiles || {};
  const tileList = Object.entries(tiles);
  const links = validLinks(C, sol);
  const wiredTo = new Set(links.map((l) => l.to));
  const sourceList = tileList.filter(([, t]) => t.type === 'source');
  const recipeFor = (out) => C.recipes.find((r) => r.out === out);
  // Area: open-floor cells the machine uses, whether by a part or a passing block.
  const isFloor = (k) => !C.walls.has(k) && !C.emitAt.has(k) && !C.portAt.has(k) && !C.plateAt.has(k);
  const used = new Set(Object.keys(tiles).filter(isFloor));

  let blocks = [];
  let nextId = 1;
  const sensors = {};
  const act = {};
  for (const [k, t] of tileList) if (isSensorType(t.type)) sensors[k] = { on: false, pip: 0 };
  const emitN = C.emitters.map(() => 0);
  const portGot = C.ports.map(() => 0);
  const plateDone = C.plates.map(() => 0);
  let linkLit = links.map(() => false);
  const frames = [];

  function snap(beat, t, extra) {
    const sens = {};
    for (const k in sensors) sens[k] = { on: sensors[k].on, pip: sensors[k].pip };
    frames.push(Object.assign({
      beat, t,
      blocks: blocks.map((b) => ({ id: b.id, x: b.x, y: b.y, sym: b.sym, dir: b.dir })),
      sensors: sens,
      act: Object.assign({}, act),
      links: linkLit.slice(),
      emit: emitN.slice(),
      ports: portGot.slice(),
      plates: plateDone.slice(),
    }, extra || {}));
  }

  // Where a block wants to go this tick, or null if it can't try.
  function targetOf(b) {
    const k = key(b.x, b.y), tile = tiles[k];
    if (tile && tile.type === 'gate' && act[k]) return null;
    const [dx, dy] = DIRS[b.dir];
    const nx = b.x + dx, ny = b.y + dy;
    if (nx < 0 || ny < 0 || nx >= C.W || ny >= C.H) return null;
    const nk = key(nx, ny);
    if (C.walls.has(nk) || C.emitAt.has(nk)) return null;
    if (tiles[nk] && tiles[nk].type === 'source') return null;
    const here = C.plateAt.get(k);
    if (here) {
      const there = C.plateAt.get(nk);
      if (!there || there.i !== here.i) return null;
    }
    return nk;
  }

  /* Move beat. Moves resolve front to back: a block advances if its target is
     empty or its occupant is also advancing. Two blocks entering one cell crash.
     Head-on (two blocks swapping cells) always crashes. A full ring advances. */
  function move(t) {
    const occ = new Map();
    for (const b of blocks) occ.set(key(b.x, b.y), b);
    const target = new Map();
    for (const b of blocks) target.set(b.id, targetOf(b));

    const status = new Map();
    const onStack = new Map();
    const stack = [];
    const crashes = [];
    const setS = (b, s) => { status.set(b.id, s); return s; };

    function resolve(b) {
      if (status.has(b.id)) return status.get(b.id);
      const tk = target.get(b.id);
      if (tk == null) return setS(b, 'stay');
      const o = occ.get(tk);
      if (!o) return setS(b, 'move');
      if (onStack.has(o.id)) {
        const cyc = stack.slice(onStack.get(o.id)).concat([b]);
        if (cyc.length === 2) {
          for (const c of cyc) status.set(c.id, 'crash');
          crashes.push({ kind: 'headon', cells: cyc.map((c) => key(c.x, c.y)), ids: cyc.map((c) => c.id) });
        } else {
          for (const c of cyc) status.set(c.id, 'move');
        }
        return status.get(b.id);
      }
      onStack.set(b.id, stack.length);
      stack.push(b);
      const r = resolve(o);
      stack.pop();
      onStack.delete(b.id);
      if (status.has(b.id)) return status.get(b.id);
      return setS(b, r === 'move' ? 'move' : 'stay');
    }
    for (const b of blocks) resolve(b);

    // Emitters
    const spawns = [];
    C.emitters.forEach((e, i) => {
      const k = key(e.x, e.y);
      const want = e.mode === 'pull'
        ? !!act[k]
        : (((t - 1 - e.phase) % e.period) + e.period) % e.period === 0;
      if (!want) return;
      if (!e.cycle && emitN[i] >= e.seq.length) return;
      const o = occ.get(k);
      if (o && status.get(o.id) !== 'move') {
        if (e.mode === 'push') crashes.push({ kind: 'blocked', cells: [k], ids: [o.id], msg: `Crash at tick ${t}: ${e.id} had no room to release a block` });
        return;
      }
      spawns.push({ i, k });
    });
    // Sources: on (unwired, or wired and lit) and clear, they release. Blocked, they wait.
    for (const [k, tile] of sourceList) {
      if (!act[k]) continue;
      const o = occ.get(k);
      if (o && status.get(o.id) !== 'move') continue;
      spawns.push({ k, src: tile });
    }

    // Contention: two or more blocks entering one cell crash, except two blocks
    // entering a join together that match its recipe: those fuse.
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const entrants = new Map();
    const add = (k, v) => { if (!entrants.has(k)) entrants.set(k, []); entrants.get(k).push(v); };
    for (const b of blocks) if (status.get(b.id) === 'move') add(target.get(b.id), b.id);
    for (const s of spawns) add(s.k, 'spawn');
    const fusions = [];
    for (const [k, list] of entrants) {
      if (list.length < 2) continue;
      const jt = tiles[k];
      if (jt && jt.type === 'join' && list.length === 2 && !list.includes('spawn')) {
        const r = recipeFor(jt.out), [s1, s2] = list.map((id) => byId.get(id).sym);
        if (r && ((s1 === r.a && s2 === r.b) || (s1 === r.b && s2 === r.a))) {
          fusions.push({ k, ids: list, out: r.out, dir: jt.dir });
          continue;
        }
      }
      crashes.push({ kind: 'collide', cells: [k], ids: list.filter((v) => v !== 'spawn') });
    }

    if (crashes.length) {
      const cells = [...new Set(crashes.flatMap((c) => c.cells))];
      const ids = [...new Set(crashes.flatMap((c) => c.ids))];
      const targets = {};
      for (const id of ids) { const tk = target.get(id); if (tk) targets[id] = tk; }
      const first = crashes[0];
      const msg = first.msg || (first.kind === 'headon'
        ? `Head-on crash at tick ${t}`
        : `Crash at tick ${t}: two blocks entered the same cell`);
      return { crash: { cells, ids, targets, msg } };
    }

    // Apply
    const moved = new Set(), arrivals = new Set(), gone = [], spawned = [], fused = [];
    const fusedIds = new Set(fusions.flatMap((f) => f.ids));
    let fail = null;
    for (const b of blocks) {
      if (status.get(b.id) !== 'move') continue;
      const tk = target.get(b.id);
      const [nx, ny] = unkey(tk);
      b.x = nx; b.y = ny;
      moved.add(b.id);
      arrivals.add(tk);
    }
    blocks = blocks.filter((b) => {
      if (!moved.has(b.id)) return true;
      const k = key(b.x, b.y);
      if (fusedIds.has(b.id)) {
        gone.push({ id: b.id, x: b.x, y: b.y, sym: b.sym, dir: b.dir, how: 'join' });
        return false;
      }
      const pi = C.portAt.get(k);
      if (pi !== undefined) {
        const p = C.ports[pi], got = portGot[pi];
        if (got >= p.expect.length) {
          if (!fail) fail = { msg: `Extra block at tick ${t}: ${p.id} already had all ${p.expect.length}`, cells: [k] };
        } else if (p.expect[got] !== b.sym) {
          if (!fail) fail = { msg: `Wrong block at tick ${t}: ${p.id} expected ${p.expect[got]}, got ${b.sym}`, cells: [k] };
        } else {
          portGot[pi]++;
        }
        gone.push({ id: b.id, x: b.x, y: b.y, sym: b.sym, dir: b.dir, how: 'port' });
        return false;
      }
      const tile = tiles[k];
      if (tile) {
        if (tile.type === 'drain') {
          gone.push({ id: b.id, x: b.x, y: b.y, sym: b.sym, dir: b.dir, how: 'drain' });
          return false;
        }
        if ((tile.type === 'filter' && tile.sym === b.sym)
          || (tile.type === 'redirect' && act[k])) b.dir = tile.dir;
      }
      return true;
    });
    for (const f of fusions) {
      const [x, y] = unkey(f.k);
      const nb = { id: nextId++, x, y, sym: f.out, dir: f.dir };
      blocks.push(nb);
      spawned.push(nb.id);
      fused.push({ x, y, sym: f.out });
    }
    for (const s of spawns) {
      let nb;
      if (s.src) {
        const [x, y] = unkey(s.k);
        nb = { id: nextId++, x, y, sym: s.src.sym, dir: s.src.dir };
      } else {
        const e = C.emitters[s.i];
        const sym = e.seq[emitN[s.i] % e.seq.length];
        emitN[s.i]++;
        nb = { id: nextId++, x: e.x, y: e.y, sym, dir: e.dir };
      }
      blocks.push(nb);
      spawned.push(nb.id);
      arrivals.add(s.k);
    }
    for (const b of blocks) { const k = key(b.x, b.y); if (isFloor(k)) used.add(k); }
    return { moved, arrivals, gone, spawned, fused, fail };
  }

  /* Signal beat. Sensors read where blocks landed, wires carry, actuators snap.
     Plates check themselves. */
  function tock(t, arrivals, moved) {
    const occ = new Map();
    for (const b of blocks) occ.set(key(b.x, b.y), b);
    for (const [k, tile] of tileList) {
      const s = sensors[k];
      if (!s) continue;
      if (tile.type === 'presence') s.on = occ.has(k);
      else if (tile.type === 'kind') s.on = occ.has(k) && occ.get(k).sym === tile.sym;
      else if (tile.type === 'clock') { s.pip = t % 2; s.on = s.pip === (tile.k || 0); }
      else if (tile.type === 'toggle') {
        if (arrivals.has(k)) s.on = !s.on;
        s.pip = s.on ? 1 : 0;
      }
    }
    linkLit = links.map((l) => sensors[l.from].on);
    const litIn = new Set();
    links.forEach((l, i) => { if (linkLit[i]) litIn.add(l.to); });
    for (const [k, tile] of tileList) {
      if (isActuatorType(tile.type)) act[k] = !wiredTo.has(k) || litIn.has(k);
    }
    for (const e of C.emitters) if (e.mode === 'pull') act[key(e.x, e.y)] = litIn.has(key(e.x, e.y));

    let fail = null;
    const cleared = [];
    C.plates.forEach((p, i) => {
      const cells = [];
      let full = true;
      for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) {
        const k = key(p.x + dx, p.y + dy), b = occ.get(k);
        if (!b) full = false;
        cells.push({ k, b, want: p.pattern[dy][dx] });
      }
      // A plate block that didn't move this tick is at rest for good.
      const bad = cells.filter((c) => c.b && c.b.sym !== c.want && (full || !moved.has(c.b.id))).map((c) => c.k);
      if (bad.length) {
        if (!fail) fail = { msg: `Wrong block on ${p.id} at tick ${t}`, cells: bad };
        return;
      }
      if (full) {
        const ids = new Set(cells.map((c) => c.b.id));
        for (const c of cells) cleared.push({ id: c.b.id, x: c.b.x, y: c.b.y, sym: c.b.sym, dir: c.b.dir });
        blocks = blocks.filter((b) => !ids.has(b.id));
        plateDone[i]++;
      }
    });
    const goals = C.ports.length + C.plates.length;
    const win = !fail && goals > 0
      && C.ports.every((p, i) => portGot[i] >= p.expect.length)
      && C.plates.every((p, i) => plateDone[i] >= p.need);
    return { fail, cleared, win };
  }

  tock(0, new Set(), new Set());
  snap('tock', 0);
  let result = null, idle = 0;
  for (let t = 1; t <= limit; t++) {
    const mv = move(t);
    if (mv.crash) {
      snap('tick', t, { crash: mv.crash });
      result = { status: 'crash', t, msg: mv.crash.msg, cells: mv.crash.cells };
      break;
    }
    snap('tick', t, { gone: mv.gone, spawned: mv.spawned, fused: mv.fused, fail: mv.fail });
    if (mv.fail) { result = { status: 'fail', t, msg: mv.fail.msg, cells: mv.fail.cells }; break; }
    const tk = tock(t, mv.arrivals, mv.moved);
    snap('tock', t, { cleared: tk.cleared, fail: tk.fail });
    if (tk.fail) { result = { status: 'fail', t, msg: tk.fail.msg, cells: tk.fail.cells }; break; }
    if (tk.win) { result = { status: 'win', t, msg: `Solved in ${t} ticks`, area: used.size }; break; }
    const exhausted = C.emitters.every((e, i) => !e.cycle && emitN[i] >= e.seq.length);
    if (exhausted && blocks.length === 0 && !sourceList.length) {
      result = { status: 'fail', t, msg: C.emitters.length ? `Out of blocks at tick ${t} before the goal was met` : 'Nothing is running yet. Place a source to start production.' };
      break;
    }
    idle = (mv.moved.size || mv.spawned.length) ? 0 : idle + 1;
    if (idle >= 16) { result = { status: 'fail', t, msg: `Stalled at tick ${t}: nothing moved for 16 ticks` }; break; }
  }
  if (!result) result = { status: 'timeout', t: limit, msg: `Out of time: the goal wasn't met in ${limit} ticks` };
  return { frames, result };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DIRS, DIR_ORDER, key, unkey, TILE_DEFS, TOOL_ORDER, LEVELS, levelTests, compileLevel,
    validLinks, solutionCost, simulate, isSensorType, isActuatorType,
  };
}
