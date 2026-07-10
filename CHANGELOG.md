# Changelog

## 0.2.0 - unreleased

The language-complete line: everything Tetro needs, validated by
`examples/tetro.glim` playing on shipped constructs only.

### Language

- Added layout types: `type Name ... end` compiles to an AZM Book 0
  `.type` record, `type Name = Expr` to `.typealias`; typed state
  (`state Cursor : Point`, `state Pieces : Piece[7]`) reserves
  zero-filled typed `.ds` storage with one change flag per cell.
  `sizeof`/`offset`/layout casts work in bodies as ordinary AZM.
- Added routines: `routine Name begin...end` callable helpers with no
  triggers and no dispatch, emitted as public `@Name:` boundaries with
  AZM-inferred register contracts.
- Added cards: `card Name` section lines, a generated `Card` enum, the
  built-in `CurrentCard` cell, card-gated block dispatch, `enter`
  blocks (edge-triggered: they run only on a genuine transition into
  their card), and `goto` in block headers with optional bodies.
  Conditional navigation — a body writing `CurrentCard` under
  `updates CurrentCard` — is a supported pattern.
- Block bodies are emitted byte-for-byte verbatim: AZM >= 0.2.17 scopes
  plain labels to their `@` routine, so the `Glim_<Block>_<label>`
  renaming is gone and `_label` is a style convention.
- Added a lint warning (diagnostics now carry a severity; warnings
  never fail the build) when a body stores directly into a
  flag-carrying cell missing from `updates`.

### Toolchain

- Added `glimmer build <entry.glim>`: generate, inject/check register
  contracts, assemble (`.hex`/`.bin`/`.d8.json`), and rewrite the
  Debug80 map so block and routine bodies step in `.glim` source while
  generated glue stays on the generated asm.
- Added the programmatic build API: `buildGlimmerProgram(entry,
  {stage, outputPath, org})` on the `@jhlagado/glimmer/build` subpath —
  in-process, no printing, AZM-shaped diagnostics ({severity, absolute
  sourceName, line, column, code}) — mirroring the
  `@jhlagado/azm/compile` API Debug80 consumes. The CLI is a thin shell
  over it; plain `glimmer` no longer emits assembly artifacts as a side
  effect (artifacts belong to `build`).
- Generated tec1g programs get an `ApiRandom .equ 49` equate; snake's
  food placement uses the real MON-3 `_random` call now that AZM's mon3
  contract profile models it.

### Examples

- `examples/tetro.glim` — the headline acceptance test: falling pieces,
  held-key movement, rotation with wall checks, locking, line clear and
  collapse with corpus scoring, a difficulty curve, and splash / pause /
  game-over cards. Piece tables and the collision engine live in a
  hand-written imported module, adapted from corpus/tetro (0BSD).

Requires `@jhlagado/azm` >= 0.2.17 (routine-scoped labels, bit-index
equates, the mon3 `_random` contract).

## 0.1.0 - 2026-07-08

First complete line (tagged, not published): a small, Debug80-friendly
Z80 game framework. Single- and multi-file `.glim` programs (parts,
AZM module imports) with scalar/array state, pulses, timers, ramps,
held/rising key bindings, compute/effect/render blocks, sound cues,
curve tables, and matrix shapes, compiled to readable AZM for the
TEC-1G/MON-3 matrix profile (generic profile default); four change-flag
banks with exactly-once rollover; register contracts inferred and
injected by AZM; `examples/snake.glim` as the first complete game.
