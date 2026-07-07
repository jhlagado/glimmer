---
layout: default
title: 'Glimmer Manual'
has_children: true
has_toc: false
nav_exclude: true
---

# Glimmer Manual

> **Pre-alpha.** Glimmer is in early design. This manual is drafted
> alongside the implementation so that documentation exists from day one,
> but the format, names, and generated output described here will change.
> It is not yet published; its eventual home is the Glimmer section of
> [debug80.com](https://debug80.com/).

Glimmer is a preprocessor and project format for AZM, the assembler used
by the Debug80 environment. A Glimmer program is written as declarative
structure — state cells, pulses, input bindings, and effects — around
small blocks of real Z80 assembly. Glimmer generates the runtime glue;
you write the behaviour.

The first target is game writing for the TEC-1G under MON-3.

## Chapters

- [Chapter 1 - Getting Started](01-getting-started.md)
- [Chapter 2 - The Glimmer Format](02-glim-format.md)

## Related

- [Glim Grammar Reference](../reference/glim-grammar.md) — the formal
  grammar and the syntax design rules
- [AZM Book 0 — Assembler Manual](https://debug80.com/azm-book/book0/) —
  the assembly language Glimmer blocks are written in
- [Debug80 documentation](https://debug80.com/) — debugging the assembled
  output
