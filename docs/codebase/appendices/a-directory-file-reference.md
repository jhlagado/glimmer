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

| File          | Purpose                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `model.ts`    | Program model types: states, pulses, timers, ramps, resources, blocks, diagnostics  |
| `load.ts`     | Multi-file loading: parts resolved and merged into one program                      |
| `parse.ts`    | Line-oriented `.glim` parser and reference validation                               |
| `generate.ts` | AZM generator: equates, storage, runtime loop, polling, dispatch, wrappers, cleanup |
| `index.ts`    | Public API: re-exports plus `compileToAzm`                                          |
| `cli.ts`      | `glimmer <entry.glim> [-o out.asm] [--org <addr>]`                                  |

## test/

| File               | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `parse.test.ts`    | Grammar and validation diagnostics                              |
| `generate.test.ts` | Generated structure, label namespacing, AZM assembly round trip |

## examples/

| File                | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `counter.glim`      | CounterToy from the specification, section 10 (generic profile)       |
| `dot.glim`          | Minimal tec1g-mon3/matrix8x8 program: held-key dot, edge-clamped      |
| `slide.glim`        | v0.2/v0.3 showcase: ramp slide, curve, shape, sound, timer blink, HUD |
| `trail.glim`        | v0.3 byte array example: moving dot stamps an 8-row trail buffer      |
| `trail-blocks.glim` | Trail's blocks as a part: the multi-file demonstration                |

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
