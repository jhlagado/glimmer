---
layout: default
title: 'Appendix A - Directory and File Reference'
parent: 'Glimmer Engineering Manual'
nav_order: 10
---

[Manual](../index.md)

# Appendix A - Directory and File Reference

Current file map. One line per file; update when files are added, removed,
or change purpose.

## src/

| File                     | Purpose                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`               | Program model types: states, pulses, timers, ramps, resources, blocks, diagnostics                                                                                                                                   |
| `load.ts`                | Multi-file loading: parts resolved and merged into one program                                                                                                                                                       |
| `parse.ts`               | Line-oriented `.glim` parser and reference validation                                                                                                                                                                |
| `generate.ts`            | AZM generator core: change flags, storage, dispatch, wrappers, rollover; profile hooks for everything platform-specific                                                                                              |
| `emit.ts`                | Shared emission helpers (hex, bin8)                                                                                                                                                                                  |
| `profiles/types.ts`      | The Profile interface and ProfileContext                                                                                                                                                                             |
| `profiles/index.ts`      | Profile selection by platform/display pair                                                                                                                                                                           |
| `profiles/generic.ts`    | Generic v0 profile: placeholder API, PrevKeys polling                                                                                                                                                                |
| `profiles/tec1g-mon3.ts` | Matrix profile: scan loop, framebuffer, sound/HUD service, shapes                                                                                                                                                    |
| `profiles/tms9918.ts`    | VDP profile: vblank pacing, commit phase, shadow tables, VDP library                                                                                                                                                 |
| `profiles/mon3-input.ts` | MON-3 keypad input shared by the TEC-1G profiles                                                                                                                                                                     |
| `index.ts`               | Public API: re-exports plus `compileToAzm`                                                                                                                                                                           |
| `build.ts`               | Programmatic build API (`@jhlagado/glimmer/build`): generate → single in-process AZM pass (assembly with `.contracts` checking riding along) → debug-map rewrite anchored at `Glim_*` labels; AZM-shaped diagnostics |
| `cli.ts`                 | Thin shell over the build API: `glimmer <entry.glim>` (stage check), `glimmer build` (full artifacts + map rewrite), `--no-check` (generate only)                                                                    |

## test/

| File                        | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `parse.test.ts`             | Grammar and validation diagnostics                                    |
| `load.test.ts`              | Multi-file loading: parts, imports, file-tagged diagnostics           |
| `generate.test.ts`          | Generated structure, verbatim bodies, AZM assembly round trip         |
| `generate-snapshot.test.ts` | Byte-identical output snapshots for every example (the refactor gate) |
| `build.test.ts`             | `glimmer build`: d8 map rewrite to `.glim` source (entry + part)      |

## examples/

| File                              | Purpose                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `counter.glim`                    | CounterToy from the specification, section 10 (generic profile)             |
| `dot.glim`                        | Minimal tec1g-mon3/matrix8x8 program: held-key dot, edge-clamped            |
| `slide.glim`                      | v0.2/v0.3 showcase: ramp slide, curve, shape, sound, timer blink, HUD       |
| `trail.glim`                      | v0.3 byte array example: moving dot stamps an 8-row trail buffer            |
| `trail-blocks.glim`               | Trail's blocks as a part: the multi-file demonstration                      |
| `snake.glim` + `snake-rules.glim` | The first complete game (multi-file); `snake-lib.asm` is an imported module |

The repo root also carries `debug80.json` with `dot` and `slide` targets so
the generated `examples/*.main.asm` programs run under Debug80's TEC-1G
platform (the `.main.asm` suffix is Debug80's entry-point naming
convention).

## corpus/

| Directory  | Purpose                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `tetro/`   | Tetro + Pacmo game suite snapshot (8x8 matrix, MON-3); adaptation target |
| `tms9918/` | TMS9918 demo programs; reference idioms for the future VDP profile       |

## sketches/

| File                | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `README.md`         | Format proposals P1–P9 raised by the sketches                    |
| `tetro.glim`        | Aspirational Tetro in Glimmer; the headline-goal design artifact |
| `sprite-chase.glim` | Aspirational interactive TMS9918 program; first VDP-profile item |

## docs/

| File                        | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `glimmer.md`                | Design specification (John's document; not auto-formatted) |
| `roadmap.md`                | Milestones, platform findings, open questions              |
| `codebase/`                 | This engineering manual                                    |
| `manual/`                   | User manual draft, future debug80-docs section             |
| `reference/glim-grammar.md` | Formal grammar and syntax design rules                     |
| `plans/v0.3.md`             | v0.3 work plan: resources, arrays, flag banks              |
