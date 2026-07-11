# Format Sketches

Design history. These files drove the format proposals below; the
working programs now live in [`examples/`](../examples/). The sketches
themselves are not maintained as compile targets — treat
`examples/tetro.glim` and `examples/sprite-chase.glim` as the authority.

- `tetro.glim` — early full-program sketch adapted from `corpus/tetro`
  (cards, held bindings, timers, arrays, resources, routines).
- `sprite-chase.glim` — early TMS9918 sketch; graduated to `examples/`
  once sprite/tile resources landed.

## Format proposals

All proposals raised by the sketches have landed or been closed. Open
language work is tracked in the [roadmap](../docs/roadmap.md), not here.

- **P1 — Platform and display declarations** (landed: matrix8x8
  2026-07-06, tms9918 2026-07-10). `platform tec1g-mon3` and
  `display matrix8x8` / `display tms9918` select the profile.
- **P2 — Array state** (landed). `state BoardRows : byte[8]`; one
  change flag for the whole array.
- **P3 — Cards** (landed 2026-07-10). `card Splash / Playing / GameOver`
  as exclusive screens/modes; section syntax through the next `card`
  line; `CurrentCard`, `enter`, and `goto`.
- **P4 — Held bindings and timers** (landed). `bind key ... held
period N ->` and `timer Name = N -> Pulse` (including `once`).
- **P5 — Routines** (landed 2026-07-10). Callable `routine` blocks with
  verbatim AZM bodies. Explicit source-level contract _clauses_ remain
  the next language candidate (see roadmap); today Glimmer emits a bare
  `.routine` for user routines and AZM infers from the body. Profile
  library routines carry curated clauses, checked against the body by
  AZM 0.3.3.
- **P6 — Resources** (landed 2026-07-10/11). Shapes (incl. rotations),
  sounds, curves, sprites, tiles, text, plus generated AZM ops
  (`lcd_row`, `sprite_at`, `tile_at`). LCD scripts remain out.
- **P7 — Word semantics** (closed 2026-07-11: deliberately narrow).
- **P8 — Profile services** (landed). Sound, HUD, RNG, and the matrix
  frame scanner are profile library routines the generated loop calls.
- **P9 — Curves and ramps** (landed). Build-time easing tables and
  monostable ramp counters composed through the reactive graph.

## Ground rules kept from the sketches

- **No Glimmer syntax inside `begin`...`end`.** A body is verbatim AZM.
  Sugar such as `lcd_row` or `sprite_at` must appear in the generated
  file as a visible AZM `op` or routine.
- Block bodies stay real Z80, in the spirit of the corpus they adapt.
- The runtime owns the loop; user programs do not write `MainLoop`.
- Everything declarative compiles to inspectable AZM.
