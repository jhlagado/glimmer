---
layout: default
title: 'Chapter 2 - The Compile Pipeline'
parent: 'Glimmer Engineering Manual'
nav_order: 2
---

[<- Orientation and Repository Layout](01-orientation-and-repository-layout.md) | [Manual](index.md)

# Chapter 2 - The Compile Pipeline

The pipeline is three stages behind one entry point:

```
compileToAzm(text)          src/index.ts
  parseGlimmer(text)        src/parse.ts    -> GlimmerProgram | diagnostics
  generateAzm(program)      src/generate.ts -> AZM source | diagnostics
```

The CLI (`src/cli.ts`) wraps `compileToAzm`, prints diagnostics as
`file:line: message`, and writes the output next to the entry file unless
`-o` overrides it.

## The program model

`src/model.ts` defines the model the parser produces and the generator
consumes:

- `StateDecl` — named byte/word cell with initial value and
  `changedOnStart`
- `PulseDecl` — one-frame transient cell, cleared by frame cleanup
- `KeyBinding` — `bind key <KEY> rising -> <Pulse>` (the only binding
  kind in v0)
- `EffectDecl` — name, phase (`derive` | `logic` | `render`), `on`
  trigger cells (stored as `depends`), `updates` cells, and a verbatim
  Z80 body captured between `begin` and `end`
- `GlimmerDiagnostic` — `{ line, message }`, line 0 for file-level issues

## Parsing

`parseGlimmer` is line-oriented. Comments start with `;` outside bodies;
block bodies are kept verbatim. Blocks declare as `compute` / `effect` /
`render` — the keyword is the phase (derive/logic/render) and enforces
kind constraints (`render` takes no `updates`; `compute` requires it).
Header lines accumulate `on` and `updates` until a line reading `begin`
opens the body, which runs until a line containing only `end`.

After the statement pass, `validateReferences` checks duplicate cell and
effect names, binding targets (must be declared pulses), `on` triggers (any
declared cell), and `updates` (declared states only). Parsing returns a
program only when there are no diagnostics.

## Generation

`generateAzm` emits one AZM file in a fixed order: header, `.org`,
placeholder API equates, key-bit equates, change-flag constants, per-effect
dependency masks, state storage, the runtime loop, `__PollBindings`,
per-phase dispatch routines, wrapped user blocks, and
`__ClearFrameState`.

Notable constraints the generator honours:

- **One change-flag byte in v0.** States then pulses, declaration order, at most
  8 cells; exceeding it is a diagnostic, not a truncation.
- **Block-local labels.** `_done` style labels are rewritten to
  globally unique labels (`Glim_ApplyIncrement_done`) by
  `namespaceLocalLabels`, which only rewrites names actually defined in
  the block. `$` is never used in generated names: it is AZM's
  current-address operator and hex prefix, not label syntax.
- **Fall-through bodies.** Block bodies must not `ret`; the generated
  wrapper appends `updates` change-marking and the final `ret`.
- **Register-contract boundaries.** Every generated routine — effect
  wrappers (`@Glim_<Effect>:`), pollers, dispatchers, cleanup — is an
  `@` entry carrying a generated `;!` contract, so the whole output is
  analyzable by AZM register contracts. Generated output passes
  `--rc strict --reg-profile mon3`; the Dot round-trip test enforces
  this.

## Profiles

`generateAzm` branches on `program.platform`:

- **Generic** (no `platform` statement): placeholder `API_*` equates,
  PrevKeys edge detection, flush-style loop. Kept for tests and for
  platform-neutral reading of the generated structure.
- **`tec1g-mon3` + `matrix8x8`**: MON-3/port equates, `_scanKeys`-based
  polling (RST $10; Z = pressed, carry = new press, so rising-edge
  bindings need no shadow byte; B holds the key code because `_scanKeys`
  may destroy DE), a scan-driven loop (`ScanFrame` shows one full frame
  with fixed row dwell, then effects run while the matrix is blank), a
  32-byte `Framebuffer` (8 rows x R,G,B,aux), and an emitted profile
  library: `ScanFrame`, `MxMask`, `FbPlot`, `FbClear` — modeled on the
  corpus Tetro/Pacmo shared layer. Binding keys are validated against the
  MON-3 key-code table in `model.ts` (`TEC1G_KEY_CODES`).

## Verification

`test/parse.test.ts` covers the statement grammar and validation
diagnostics. `test/generate.test.ts` covers generated structure and the
round trip: the CounterToy example is compiled, written to a temp
directory, and assembled with the real `@jhlagado/azm` compile API; the
test fails on any AZM error diagnostic. This round trip is the guard that
keeps generated output honest against the assembler — keep it green.
