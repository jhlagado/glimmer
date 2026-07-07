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
| `model.ts`    | Program model types: states, pulses, bindings, effects, phases, diagnostics         |
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

| File           | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `counter.glim` | CounterToy from the specification, section 10 (generic profile)    |
| `dot.glim`     | Minimal tec1g-mon3/matrix8x8 program: held-key dot, edge-clamped   |
| `slide.glim`   | v0.2 showcase: ramp-driven slide, compute, timer blink, sound, HUD |

The repo root also carries `debug80.json` with a `dot` target so the
generated `examples/dot.asm` runs under Debug80's TEC-1G platform.

## corpus/

| Directory  | Purpose                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `tetro/`   | Tetro + Pacmo game suite snapshot (8x8 matrix, MON-3); adaptation target |
| `tms9918/` | TMS9918 demo programs; reference idioms for the future VDP profile       |

## sketches/

| File                | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `README.md`         | Format proposals P1–P8 raised by the sketches                    |
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
