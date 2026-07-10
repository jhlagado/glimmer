# Format Sketches

Aspirational `.glim` files. **None of these compile yet.** They are design
artifacts: each one takes a real corpus program and asks what it _should_
look like in Glimmer. Where a sketch needs something v0 does not have,
that is a numbered format proposal, catalogued below and folded into the
[roadmap](../roadmap.md) milestones.

- `tetro.glim` — the headline goal, adapted from `corpus/tetro`. The full
  workout: cards, held bindings, timers, array state, resources, sounds,
  routines.
- `sprite-chase.glim` — the TMS9918 demos made interactive: a
  player-steered sprite chasing a target over a tile background. The VDP
  demos are displays, not games; this adds the missing dynamics and
  exercises the second display profile.

## Format proposals raised by the sketches

- **P1 — Platform and display declarations.** `platform tec1g-mon3` and
  `display matrix8x8` / `display tms9918 mode graphics1` select the
  profile: real port/API equates, the loop skeleton (scan-driven vs
  vblank-paced), and the profile library (framebuffer or VRAM helpers).
- **P2 — Array state.** `state BoardRows : byte[8]`. Change tracking stays
  per-cell (the whole array is one change flag); Tetro treats the board as
  one unit already.
- **P3 — Cards** (landed 2026-07-10)**.** `card Splash / Playing / GameOver` as first-class
  modes (HyperCard sense: screens; exactly one active). A `card` line
  starts a **section** — everything after it belongs to that card until
  the next `card` line or end of file; there is no closing keyword, so
  the language stays nesting-free. A built-in `CurrentCard` state cell
  plus a generated `Card` enum; effects in a card's section only
  dispatch while it is active; `enter` effects run once on card entry
  (triggered by `CurrentCard` changing). This replaces Tetro's
  hand-rolled flag dispatch (`GameOver`/`SplashTimer`/`Paused` checks at
  the top of LogicTick).
- **P4 — Held bindings and timers.** `bind key ... held period N ->`
  for autorepeat (Tetro's MoveCooldown pattern), alongside `rising`.
  `timer Gravity = 32 -> GravityFire` declares a per-frame countdown
  cell that fires a pulse and reloads; the cell is writable state, so
  difficulty curves (gravity speeding up at 2000 points) are ordinary
  `updates`.
- **P5 — Routines** (landed 2026-07-10)**.** `routine <Name>` declarations: callable helper
  blocks (collision checks, geometry) that are not effects — no
  triggers, no dispatch, just a named, contract-carrying routine many
  effects call.
- **P6 — Resources.** Declarative data compiled to `.db` tables:
  `shape` (pixel-art rows with a colour), `sound` (duration + divider,
  generating a trigger routine), `text` (LCD strings). Pixel rows are
  written as ASCII art (`"..XX...."`), which is both readable and
  checkable. Where a resource offers callable sugar (`lcd_row`,
  `sprite_at`), that sugar is an **AZM `op` definition emitted into the
  generated file** — AZM ops take typed parameters
  (`op lcd_row(msg imm16, row imm8)`) and expand inline, so effect
  bodies invoke them as ordinary AZM. Glimmer adds no macro system of
  its own.
- **P7 — Word semantics.** 16-bit compares in ordinary effect code
  (score thresholds) and word cells in `updates`. Already half-present in
  v0 (word storage), needs change-flag semantics defined.
- **P9 — Curves and ramps (easing).** Three orthogonal pieces composing
  through the reactive graph. `curve SlideIn ease_out steps 16 from 0
to 7`: the compiler does the floating-point easing at build time and
  emits a ROM table precomputed in destination space (actual pixel
  positions) — runtime cost is one indexed load (three instructions
  with a page-aligned table via `.align`). Presets: linear, ease_in,
  ease_out, ease_in_out, sine, overshoot, anticipation. Hand-tuned
  value lists remain a later extension. `ramp Slide : byte steps 16 -> SlideDone`: a
  monostable progress counter that steps each frame, marks its cell
  changed each step, then stops and fires its pulse — retriggered by
  an ordinary write to its cell (no new trigger syntax). A derive
  effect maps ramp through curve into position. Envelopes are chained
  ramps (completion pulse starts the next) or one longer table.
  Platform precedent: the TMS9918 demo's precomputed sub-pixel phase
  banks and Tetro's rotation tables. Depends on change-flag rollover
  (per-frame producers need deferral, not dropping).
- **P8 — Profile services.** Sound service, HUD scan, RNG, and (matrix)
  the frame scanner are profile library routines the generated loop
  calls — not user code, not generated glue. The sketches call them by
  documented names (`Snd_*` wrappers, `HudWriteScore`, `Random`).

## Ground rules kept by the sketches

- **No Glimmer syntax inside `begin`...`end`.** A body is verbatim AZM:
  Z80 instructions, labels, `call`s to routines, and AZM `op`
  invocations. Anything that looks like sugar (`lcd_row`, `sprite_at`,
  `Snd_Rotate`) must exist in the generated file as a visible AZM `op`
  or routine that Glimmer emitted from a declaration. One macro system,
  owned by AZM.
- Block bodies are real Z80 (AZM), unchanged in spirit from the
  corpus code they adapt.
- The runtime owns the loop; nothing in a sketch writes `MainLoop`.
- Everything declarative compiles to inspectable AZM — no construct is
  allowed that cannot be shown as generated assembly.
