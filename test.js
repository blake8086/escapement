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

// Naive attempts the levels are meant to reject.
const byId = (id) => S.LEVELS.find((l) => l.id === id);
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
