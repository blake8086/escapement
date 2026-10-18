# Escapement

*Working title.* A prototype puzzle game in the spirit of Zachtronics' Opus Magnum, where everything happens on one grid. There's no instruction pane. The machine is the program: blocks slide across the board, and sensors, wires, and actuators decide where they go.

## Play

**[Play it in your browser](https://blake8086.github.io/escapement/)**, or open `docs/index.html` locally. It's a single self-contained page with no build step needed to play.

The four **Challenges** give you only the goal: two are medium, two are very difficult. Each allows one source of each symbol, and all four share the same parts. (The reference machines in `src/sim.js` and the machines in `test.js` are full solutions, so skip those files if you want to solve them yourself.)

The **Workshop** levels are an experiment in construction: only the output is fixed. You place the sources (so all timing is your own) and use joins to fuse ingredients into products, scored on cost, ticks, and area. The ten **Routing** levels build up from simple routing to wired logic, ending with a checkerboard that takes real planning. Each level has two targets, cost and ticks, taken from the best machines found so far. A star in the level grid means you've hit both. If you're stuck, each level can show a working (but beatable) machine.

Sound is synthesized in the page: accepted blocks chime by symbol, so a running machine plays a little tune. Press `M` to mute.

## Rules

- Blocks slide one cell per tick along their heading, and wait if the cell ahead is occupied.
- Two or more blocks entering the same cell crash, and head-on always crashes.
- **Static tiles:** filter (turns only blocks with its symbol), drain (removes blocks).
- **Sensors:** presence, kind, clock (alternates every tick), toggle (flips each time a block arrives).
- **Actuators:** redirect (turns blocks), gate (holds a block). An actuator with no wire is always on. Once wired, it acts only while lit.
- Wires run from sensors to actuators or pull emitters. Actuators react to what their sensors read on the previous tick.

## Controls

- **Place:** drag a part onto the board, or pick it and click a cell.
- **Move:** drag a placed part. Drop it off the board to remove it.
- **Wire:** click a sensor, then click actuators to connect them. Click an empty cell to stop.
- **Edit:** click a part. `R` rotates, `Del` or right-click removes.
- **Run:** `Space` plays, `←` `→` step one tick, `Ctrl+Z` undoes, `M` mutes.

## Development

```
python3 build.py   # bundles src/ into docs/index.html (and build/fragment.html for the artifact viewer)
node test.js       # runs the simulation tests
```

| File | What it is |
| --- | --- |
| `src/sim.js` | The simulation: a pure, deterministic step function, plus the levels and their reference solutions |
| `src/ui.js` | Board rendering, editing, wiring, and the scrubber |
| `src/style.css` | Styles |
| `src/shell.html` | Page skeleton the build fills in |
| `test.js` | Checks that every reference machine wins, every target is reached by a real machine, tempting wrong approaches fail, and the collision rules hold |
| `docs/index.html` | The built, playable page, published with GitHub Pages |

The simulation has no dependency on the UI, so `sim.js` runs in Node for testing. Every edit in the game re-runs the simulation from tick 0, which is what keeps the scrubber live.
