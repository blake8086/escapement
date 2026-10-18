const S = require('./src/sim.js');

let failures = 0;
const expect = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (wanted ${want})`}`);
};

// Every reference solution wins every test; an empty board never wins.
for (const L of S.LEVELS) {
  S.levelTests(L).forEach((_, i) => {
    const r = S.simulate(L, i, L.ref);
    expect(`${L.id} ref test ${i + 1}`, r.result.status, 'win');
    if (r.result.status !== 'win') console.log('     ', r.result.msg);
    else console.log('      ', r.result.msg, '| cost', S.solutionCost(L.ref));
  });
  const empty = S.simulate(L, 0, { tiles: {}, links: [] });
  expect(`${L.id} empty board`, empty.result.status === 'win' ? 'win' : 'no-win', 'no-win');
  console.log('      ', empty.result.msg);
}

const byId = (id) => S.LEVELS.find((l) => l.id === id);
const R = (dir) => ({ type: 'redirect', dir });
const runAll = (L, sol) => {
  const rs = S.levelTests(L).map((_, i) => S.simulate(L, i, sol).result);
  const win = rs.every((r) => r.status === 'win');
  return {
    win, cost: S.solutionCost(sol), ticks: win ? Math.max(...rs.map((r) => r.t)) : null,
    area: win ? Math.max(...rs.map((r) => r.area)) : null, msg: rs.find((r) => r.status !== 'win')?.msg,
  };
};
const src = (sym, dir) => ({ type: 'source', sym, dir });
const join = (out, dir) => ({ type: 'join', out, dir });
const noWin = (label, L, sol) => {
  const r = runAll(L, sol);
  expect(label, r.win ? 'win' : 'no-win', 'no-win');
  console.log('      ', r.msg);
};

// Targets: the best machines found. Each level's par cost and par ticks must be
// reached by a real machine here (the reference counts), and none may beat them.
const BEST = {
  'sorting-office': [{ tiles: { '2,2': { type: 'filter', dir: 'N', sym: 'A' }, '6,2': { type: 'filter', dir: 'S', sym: 'B' }, '7,2': { type: 'drain' } }, links: [] }],
  'swap-pairs': [{ tiles: { '2,3': { type: 'filter', dir: 'N', sym: 'A' }, '2,1': R('E'), '6,1': R('S'), '6,3': R('E') }, links: [] }],
  'four-ways': [{
    tiles: { '2,3': { type: 'toggle' }, '3,3': R('N'), '3,2': { type: 'toggle' }, '3,1': R('W'), '5,3': R('S') },
    links: [{ from: '2,3', to: '3,3' }, { from: '3,2', to: '3,1' }, { from: '3,2', to: '5,3' }],
  }],
  'checkerboard': [{
    tiles: {
      '2,1': { type: 'filter', dir: 'S', sym: 'A' }, '2,2': { type: 'toggle' }, '2,3': R('E'), '2,4': R('E'),
      '5,4': R('E'), '6,4': R('S'), '7,3': R('S'), '5,1': R('S'), '7,1': R('S'),
    },
    links: [{ from: '2,2', to: '2,3' }, { from: '2,2', to: '5,1' }],
  }],
  // One C line split by a toggle; every even C is held a tick so pairs reach the D join together.
  'double-up': [{
    tiles: {
      '1,4': src('A', 'E'), '2,3': src('B', 'S'), '2,4': join('C', 'E'),
      '3,4': { type: 'toggle' }, '4,4': R('N'), '4,3': R('E'), '12,3': R('S'),
      '8,3': { type: 'presence' }, '8,4': { type: 'gate' }, '12,4': join('D', 'E'),
    },
    links: [{ from: '3,4', to: '4,4' }, { from: '8,3', to: '8,4' }],
  }],
  // One C line split by a toggle; a sensor on the even path releases the A for each D.
  'bakery': [{
    tiles: {
      '1,3': src('A', 'E'), '2,2': src('B', 'S'), '2,3': join('C', 'E'),
      '3,3': { type: 'toggle' }, '4,3': R('S'), '4,5': R('E'), '11,5': R('S'),
      '12,3': R('S'), '12,4': join('D', 'S'), '13,4': src('A', 'W'), '11,3': { type: 'presence' },
    },
    links: [{ from: '3,3', to: '4,3' }, { from: '11,3', to: '13,4' }],
  }],

  /* SPOILERS from here to the end of BEST: best known machines for the challenges. */
  'call-and-response': [{
    tiles: { '7,4': src('B', 'E'), '8,4': { type: 'toggle' }, '9,4': join('E', 'E'), '9,3': src('C', 'S'), '10,4': join('D', 'E'), '10,3': src('A', 'S') },
    links: [{ from: '8,4', to: '9,3' }, { from: '8,4', to: '10,3' }],
  }],
  'matchmaker': [{
    tiles: { '4,4': { type: 'presence' }, '5,4': { type: 'kind', sym: 'B' }, '7,2': src('X', 'S'), '7,3': R('E'), '8,3': R('S'), '7,4': join('D', 'E'), '8,4': join('E', 'E') },
    links: [{ from: '4,4', to: '7,2' }, { from: '5,4', to: '7,3' }],
  }],
  'two-step': [{
    tiles: {
      '4,4': src('B', 'E'), '5,4': { type: 'toggle' }, '6,4': R('N'), '6,3': R('E'), '8,3': R('S'), '8,4': R('E'), '7,4': { type: 'toggle' },
      '9,4': join('D', 'E'), '9,3': src('A', 'S'), '10,4': join('E', 'E'), '10,0': src('C', 'S'),
    },
    links: [{ from: '5,4', to: '6,4' }, { from: '7,4', to: '9,3' }, { from: '7,4', to: '10,0' }],
  }],
  'waltz': [{
    tiles: {
      '5,4': src('A', 'E'), '7,0': src('C', 'S'), '7,1': { type: 'gate' }, '7,2': { type: 'presence' }, '7,3': { type: 'presence' },
      '7,4': join('E', 'E'), '8,4': { type: 'kind', sym: 'A' }, '10,4': join('D', 'E'), '10,3': src('B', 'S'),
    },
    links: [{ from: '7,2', to: '7,1' }, { from: '7,3', to: '7,1' }, { from: '8,4', to: '10,3' }],
  }],
};
for (const L of S.LEVELS) {
  const results = [L.ref].concat(BEST[L.id] || []).map((sol) => runAll(L, sol));
  results.forEach((r, i) => { if (!r.win) { failures++; console.log(`FAIL ${L.id} machine ${i} does not win: ${r.msg}`); } });
  const wins = results.filter((r) => r.win);
  expect(`${L.id} par cost reached`, Math.min(...wins.map((r) => r.cost)), L.par.cost);
  expect(`${L.id} par ticks reached`, Math.min(...wins.map((r) => r.ticks)), L.par.ticks);
  if (L.par.area != null) expect(`${L.id} par area reached`, Math.min(...wins.map((r) => r.area)), L.par.area);
}

// Joins and sources.
{
  const L = byId('first-join');
  noWin('first-join with unequal paths (a lone A reaches the output)', L, { tiles: { '7,3': join('C', 'E'), '6,3': src('A', 'E'), '7,0': src('B', 'S') }, links: [] });
  const r = runAll(L, { tiles: { '7,3': join('C', 'E'), '4,3': src('A', 'E'), '7,0': src('B', 'S') }, links: [] });
  expect('first-join with paths matched wins', r.win, true);
  const wrong = S.simulate(L, 0, { tiles: { '7,3': join('C', 'E'), '6,3': src('A', 'E'), '7,2': src('A', 'S') }, links: [] }).result;
  expect('two As into an A+B join crash', wrong.status, 'crash');
  const blocked = S.simulate(L, 0, { tiles: { '6,3': src('A', 'E'), '7,3': { type: 'gate' } }, links: [] }).result;
  expect('a blocked source waits instead of crashing', blocked.status, 'fail');
  console.log('      ', blocked.msg);
}
{
  const L = byId('double-up');
  noWin('double-up shared line without the one-tick hold', L, {
    tiles: {
      '1,4': src('A', 'E'), '2,3': src('B', 'S'), '2,4': join('C', 'E'),
      '3,4': { type: 'toggle' }, '4,4': R('N'), '4,3': R('E'), '12,3': R('S'), '12,4': join('D', 'E'),
    },
    links: [{ from: '3,4', to: '4,4' }],
  });
}
{
  const L = byId('bakery');
  noWin('bakery with C in both columns', L, {
    tiles: { '11,3': join('C', 'S'), '10,3': src('A', 'E'), '11,2': src('B', 'S'), '12,3': join('C', 'S'), '12,2': src('B', 'S'), '13,3': src('A', 'W') }, links: [],
  });
}

// Challenges: one source per symbol, and the obvious shortcuts fail. (Spoilers.)
{
  const L = byId('call-and-response');
  noWin('call-and-response with two B sources', L, { tiles: { '0,4': src('B', 'E'), '0,5': src('B', 'E') }, links: [] });
  noWin('call-and-response with a source of a symbol it lacks', L, { tiles: { '0,4': src('D', 'E') }, links: [] });
  noWin('call-and-response with every B going to D', L, { tiles: { '0,4': src('B', 'E'), '3,3': src('A', 'S'), '3,4': join('D', 'E') }, links: [] });
  noWin('two-step with the alternating machine', byId('two-step'), BEST['call-and-response'][0]);
  noWin('matchmaker sorting by filter onto one shared X line', byId('matchmaker'), {
    tiles: {
      '2,4': { type: 'filter', sym: 'A', dir: 'N' }, '3,4': R('S'), '2,3': R('N'), '2,2': R('E'), '3,5': R('S'), '3,6': R('E'),
      '5,0': src('X', 'S'), '5,2': join('D', 'E'), '5,6': join('E', 'E'), '5,7': { type: 'drain' },
      '8,2': R('S'), '8,3': R('S'), '8,4': R('E'), '8,6': R('N'), '8,5': R('N'),
    },
    links: [],
  });
  noWin('waltz with one toggle feeding both partners', byId('waltz'), {
    tiles: { '7,4': src('A', 'E'), '8,4': { type: 'toggle' }, '9,4': join('E', 'E'), '9,3': src('C', 'S'), '10,4': join('D', 'E'), '10,3': src('B', 'S') },
    links: [{ from: '8,4', to: '9,3' }, { from: '8,4', to: '10,3' }],
  });
}

// Naive attempts the levels are meant to reject.
{
  const L = byId('zipper');
  const r = S.simulate(L, 0, { tiles: { '3,3': { type: 'redirect', dir: 'E' } }, links: [] });
  expect('zipper with only an unwired redirect crashes', r.result.status, 'crash');
}
{
  const L = byId('even-split');
  const r = S.simulate(L, 0, { tiles: { '4,2': { type: 'redirect', dir: 'N' } }, links: [] });
  expect('even-split all one way fails', r.result.status, 'fail');
  console.log('      ', r.result.msg);
}
{
  const L = byId('on-cue');
  const r = S.simulate(L, 0, {
    tiles: { '2,3': { type: 'redirect', dir: 'E' }, '5,0': { type: 'clock', k: 0 } },
    links: [{ from: '5,0', to: '2,0' }, { from: '5,0', to: '0,3' }],
  });
  expect('on-cue one clock on both emitters fails', r.result.status === 'win' ? 'win' : 'no-win', 'no-win');
  console.log('      ', r.result.msg);
}
{
  // Zipper: the delay B needs is odd, so a detour (always even) can't fix it.
  const L = byId('zipper');
  noWin('zipper with B detouring two cells', L, { tiles: { '3,1': R('E'), '4,1': R('S'), '4,2': R('W'), '3,2': R('S'), '3,3': R('E') }, links: [] });
}
{
  // Swap Pairs: only a siding exactly two cells longer than the short one works without wiring.
  const L = byId('swap-pairs');
  const siding = (row) => ({ tiles: { '2,3': { type: 'filter', dir: 'N', sym: 'A' }, [`2,${row}`]: R('E'), [`6,${row}`]: R('S'), '6,3': R('E') }, links: [] });
  noWin('swap-pairs short siding', L, siding(2));
  noWin('swap-pairs longest siding', L, siding(0));
}
{
  // Crossroads: both streams have odd periods, so no clock or detour separates them.
  const L = byId('crossroads');
  for (const k of [0, 1]) {
    noWin(`crossroads clock (${k}) gating B`, L, { tiles: { '5,2': { type: 'clock', k }, '4,4': { type: 'gate' } }, links: [{ from: '5,2', to: '4,4' }] });
    noWin(`crossroads clock (${k}) gating A`, L, { tiles: { '5,2': { type: 'clock', k }, '3,3': { type: 'gate' } }, links: [{ from: '5,2', to: '3,3' }] });
  }
  const r = runAll(L, { tiles: { '4,4': { type: 'presence' }, '3,3': { type: 'gate' } }, links: [{ from: '4,4', to: '3,3' }] });
  expect('crossroads gating A instead also works', r.win, true);
}
{
  // Checkerboard: sending each symbol to a fixed column fails.
  const L = byId('checkerboard');
  noWin('checkerboard fixed columns', L, { tiles: { '2,1': { type: 'filter', dir: 'S', sym: 'A' }, '2,3': R('E'), '7,3': R('S'), '6,1': R('S') }, links: [] });
}

// Collision rules on bare test boards.
const bare = (w, emitters) => ({ id: 't', name: 't', w, h: 3, emitters, ports: [{ id: 'O', x: w - 1, y: 2, expect: 'AAAAAAAA' }] });
{
  const L = bare(5, [{ id: 'L', x: 0, y: 0, dir: 'E', period: 50, seq: 'A' }, { id: 'R', x: 4, y: 0, dir: 'W', period: 50, seq: 'A' }]);
  const r = S.simulate(L, 0, { tiles: {}, links: [] });
  expect('head-on with a one-cell gap', r.result.msg, 'Crash at tick 3: two blocks entered the same cell');
}
{
  const L = bare(4, [{ id: 'L', x: 0, y: 0, dir: 'E', period: 50, seq: 'A' }, { id: 'R', x: 3, y: 0, dir: 'W', period: 50, seq: 'A' }]);
  const r = S.simulate(L, 0, { tiles: {}, links: [] });
  expect('head-on adjacent', r.result.msg, 'Head-on crash at tick 3');
}
{
  // Four blocks fed into a 2x2 ring of turn tiles keep circulating.
  const L = { id: 'ring', name: 'ring', w: 4, h: 4, emitters: [{ id: 'E', x: 1, y: 0, dir: 'S', period: 1, seq: 'AAAA' }], ports: [{ id: 'O', x: 3, y: 3, expect: 'A' }] };
  const sol = { tiles: { '1,1': { type: 'redirect', dir: 'E' }, '2,1': { type: 'redirect', dir: 'S' }, '2,2': { type: 'redirect', dir: 'W' }, '1,2': { type: 'redirect', dir: 'N' } }, links: [] };
  const r = S.simulate(L, 0, sol, 40);
  expect('full ring advances together', r.result.status, 'timeout');
}
{
  // A side block waits beside a stopped queue, then crashes when the queue moves.
  // A gate wired to a toggle: the first C block flips it lit (hold), the second flips it dark (release).
  const L = { id: 'merge', name: 'merge', w: 6, h: 4,
    emitters: [
      { id: 'Q', x: 0, y: 1, dir: 'E', period: 2, seq: 'AAA' },
      { id: 'S', x: 3, y: 3, dir: 'N', period: 50, phase: 4, seq: 'B' },
      { id: 'R', x: 0, y: 3, dir: 'E', period: 7, seq: 'CC' },
    ],
    ports: [{ id: 'O', x: 5, y: 1, expect: 'AAAB' }] };
  const sol = { tiles: { '4,1': { type: 'gate' }, '1,3': { type: 'toggle' } }, links: [{ from: '1,3', to: '4,1' }] };
  const r = S.simulate(L, 0, sol);
  expect('side merge into a released queue crashes', r.result.msg, 'Crash at tick 10: two blocks entered the same cell');
}
{
  // An unwired gate holds forever; an unwired redirect always turns.
  const L = byId('first-turn');
  const r = S.simulate(L, 0, { tiles: { '1,1': { type: 'gate' } }, links: [] });
  expect('unwired gate holds forever', r.result.status === 'win' ? 'win' : 'no-win', 'no-win');
  console.log('      ', r.result.msg);
}
{
  // Toggles alternate per arrival; a clock is useless when blocks arrive in step with it.
  const L = byId('four-ways');
  const clockOnly = S.simulate(L, 0, {
    tiles: { '2,3': { type: 'clock', k: 0 }, '3,3': { type: 'redirect', dir: 'N' } },
    links: [{ from: '2,3', to: '3,3' }],
  });
  expect('four-ways with a clock fails', clockOnly.result.status === 'win' ? 'win' : 'no-win', 'no-win');
  console.log('      ', clockOnly.result.msg);
  const oneToggle = S.simulate(L, 0, {
    tiles: { '2,3': { type: 'toggle' }, '3,3': { type: 'redirect', dir: 'N' } },
    links: [{ from: '2,3', to: '3,3' }],
  });
  expect('four-ways with one toggle fails', oneToggle.result.status === 'win' ? 'win' : 'no-win', 'no-win');
  console.log('      ', oneToggle.result.msg);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
