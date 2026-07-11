# Glimmer Roadmap

Current as of 2026-07-11. Detailed release history lives in
[CHANGELOG.md](../CHANGELOG.md); completed implementation plans remain in
[`docs/plans/`](plans/) as design records.

## Contract

Glimmer's essential contract is:

```text
.glim source -> readable generated AZM -> HEX / BIN / Debug80 map
```

Glimmer owns the structured source, reactive runtime generation, profile
selection, and `.glim` source attribution. AZM owns assembly, layout types,
operations, register contracts, and machine-code artifacts. Debug80 owns
emulation and the debugging experience.

The generated AZM file is a canonical, inspectable interface rather than a
hidden intermediate. `glimmer build` runs the complete chain for convenience,
and `buildGlimmerProgram` exposes the same workflow in process to Debug80.

## Current release line

Version 0.5.3 is the AZM 0.3 and native-Debug80 line:

- generated files declare `.contracts` policy and `.routine` boundaries;
- curated profile routines carry explicit register interfaces while user
  blocks and routines are inferred from their bodies;
- `glimmer build` performs one AZM assembly pass and rewrites the resulting
  map so user-body segments point back to `.glim` source;
- Debug80 recognises `.glim`, builds it through the Glimmer API, and supports
  breakpoints and stepping in the original file;
- the installed npm command works through package-manager bin symlinks.

The first published line is complete. New work is selected by pressure from
real programs and additional platforms, not by an attempt to hide Z80 behind
an ever-larger language.

## Shipped language

- scalar byte and word state, byte arrays, and AZM layout-typed state;
- pulses, oscillator and one-shot timers, ramps, and `FrameCount`;
- rising, held-autorepeat, and any-key bindings on TEC-1G/MON-3;
- `compute`, `effect`, and `render` blocks with explicit `on` and `updates`;
- callable `routine` blocks and byte-for-byte verbatim AZM bodies;
- cards as exclusive screens or modes, edge-triggered `enter` blocks, and
  frame-boundary `goto` navigation;
- multi-file programs through `part` and hand-written AZM modules through
  `.import`;
- sound cues, curves, matrix shapes and rotations, LCD text, TMS9918 sprites,
  tiles, and generated AZM `op` helpers;
- four change-flag banks with exactly-once same-frame or next-frame delivery.

## Shipped profiles

### TEC-1G matrix8x8

The CPU scans the display. `ScanFrame` services all eight rows, sound, and the
seven-segment HUD; reactive work runs in the inter-frame blanking window.
MON-3 supplies keypad polling, LCD calls, and random numbers.

### TEC-1G TMS9918

The VDP renders independently. The loop waits for vertical blank, commits dirty
name-table rows and sprite attributes from shadows, polls input, and runs the
reactive phases. Sprite and tile declarations generate their pattern upload and
Graphics I colour groups.

### Generic

The generic profile emits placeholder APIs and an audit contract policy. It is
useful for tests and for inspecting the platform-neutral runtime shape, not as a
finished hardware target.

## Acceptance programs

- `examples/dot.glim`: smallest matrix input-to-pixel program;
- `examples/slide.glim`: timers, ramps, curves, sound, shapes, and HUD;
- `examples/trail.glim`: array state and `part` composition;
- `examples/snake.glim`: first complete multi-file game;
- `examples/tetro.glim`: matrix headline game, cards, rotations, LCD, scoring,
  line-clear flash, pause, and game-over flow;
- `examples/sprite-chase.glim`: second-display acceptance game with declarative
  sprites, tiles, and generated VDP operations.

All examples are snapshot-covered and assemble under their applicable AZM
contract policy. Tetro and sprite-chase are native targets in `debug80.json`;
`tetro-glim` is the repository default.

## Remaining validation

Two checks cannot be completed by repository automation:

1. Play Tetro through its full splash, movement, rotation, lock, line-clear,
   pause, restart, LCD, HUD, and sound paths in Debug80 and on TEC-1G hardware.
2. Play sprite-chase through input, sprite movement, collision, score tiles,
   and sustained VDP commit timing in Debug80 and on a TEC-Deck.

Findings from those sessions are release maintenance, not new language scope.
Strict assembly and emulator startup are necessary evidence but are not a
substitute for behavioural playtesting.

## Next language phase

The strongest next candidate is **source-level routine contract clauses**.
AZM 0.3.3 verifies explicit `.routine` interfaces against _callers_ and
against each routine's own body-effect summary (`declaration_contract_mismatch`
when a body write is preserved or left unmentioned). Glimmer already emits
reliable boundaries (bare `.routine` for user blocks; curated clauses on
profile library routines, audited against that body check). What remains is
a readable `.glim` header syntax that passes explicit `in`, `out`,
`maybe-out`, `clobbers`, and `preserves` clauses through into the generated
`.routine` line — without putting non-Z80 semantics inside the body — plus
negative tests on the Glimmer side.

Profiles may later move monitor interfaces into AZM `.asmi` files when that
is more useful than the current register profile.

## Later, evidence-driven work

- **`.glim` libraries:** reusable state, bindings, effects, and resources need
  a namespace and ownership model beyond `part` merge semantics.
- **Generated module splitting:** move stable runtime/profile sections into
  `.import` units only if editor and debugging experience improves.
- **Per-block diagnostics:** editor-time isolated assembly and richer dataflow
  analysis, while preserving whole-program verification as the authority.
- **Additional profiles:** joystick input, TMS9918 Graphics II or NMI pacing,
  sound hardware, and other Z80 systems supported by Debug80.
- **Larger corpus adaptations:** Pacmo and future games should justify new
  constructs rather than merely demonstrate existing ones again.
- **Native source origins:** an AZM `.loc`-style directive could eventually
  replace Glimmer's map post-processing if the mechanism benefits other source
  generators too.

## Explicitly not goals

- replacing AZM with a second assembler or macro language;
- hiding generated assembly;
- conditional navigation syntax inside Z80 bodies;
- blocking music as the default matrix sound model;
- adding abstractions without a game, tool, or platform that needs them.
