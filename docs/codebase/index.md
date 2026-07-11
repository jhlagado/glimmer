---
layout: default
title: 'Glimmer Engineering Manual'
nav_order: 92
has_children: true
has_toc: false
---

# Glimmer Engineering Manual

This book is a technical reference for engineers working on the Glimmer
preprocessor. It explains the repository structure, the compile pipeline
from `.glim` meta-source to generated AZM, the diagnostics model, and the
verification lanes that support the implementation.

This manual is updated against the Glimmer codebase state through
**2026-07-11**. Use it as the map when planning changes. Use the TypeScript
source and tests as the final authority when a detail has changed.

Glimmer is deliberately small. The codebase is organised around one central
path: parse `.glim` meta-source into a program model, validate references,
and generate a single AZM source file containing the runtime glue and the
user's Z80 blocks. Everything downstream — assembling, debug maps,
emulation — belongs to AZM and Debug80.

---

## Chapters

- [Chapter 1 - Orientation and Repository Layout](01-orientation-and-repository-layout.md)
- [Chapter 2 - The Compile Pipeline](02-compile-pipeline.md)

## Appendices

- [Appendix A - Directory and File Reference](appendices/a-directory-file-reference.md)

## Related Documents

- [Glimmer Interactive Runtime Specification](../glimmer.md) — the design
  foundation
- [Roadmap](../roadmap.md) — milestones and platform findings
