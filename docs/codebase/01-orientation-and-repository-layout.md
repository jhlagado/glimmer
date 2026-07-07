---
layout: default
title: 'Chapter 1 - Orientation and Repository Layout'
parent: 'Glimmer Engineering Manual'
nav_order: 1
---

[Manual](index.md) | [The Compile Pipeline ->](02-compile-pipeline.md)

# Chapter 1 - Orientation and Repository Layout

Glimmer is a preprocessor and project format for AZM. It compiles a
structured program — state cells, pulses, input bindings, and effects whose
bodies are plain Z80 blocks — into one generated AZM source
file. The design rationale lives in the
[Glimmer Interactive Runtime Specification](../glimmer.md).

The essential contract is:

```
.glim file in  →  generated .asm (AZM) file out
```

Glimmer does not assemble. The generated AZM is the canonical interface:
AZM assembles it into Intel HEX, flat binary, and `.d8.json` Debug80 maps,
and Debug80 debugs it at source level. Keeping the boundary there serves
the project's transparency principle — the user can always read what
Glimmer wrote.

## Ecosystem

Glimmer sits alongside three sibling repositories:

- **AZM** — the Z80 assembler Glimmer targets. Generated output uses
  canonical AZM style: lowercase dotted directives, name-left declarations,
  `@Name:` routine entries.
- **debug80** — the VS Code debugging environment. Its TEC-1G platform
  (MON-3 monitor, 8x8 RGB matrix, TMS9918 TEC-Deck card) is Glimmer's
  first hardware target.
- **debug80-docs** — the Jekyll documentation site at debug80.com, the
  eventual publication home for the Glimmer manual.

## Repository layout

```
src/          compiler implementation (TypeScript, ESM, Node >= 20)
test/         vitest suites, including an AZM round-trip assembly test
examples/     .glim example programs (generated .asm artifacts gitignored)
corpus/       real TEC-1G programs (Tetro, Pacmo, TMS9918 demos) copied in
              as reference source and Glimmer-adaptation material
sketches/     aspirational .glim drafts that define the target format
              (do not compile; each gap is a numbered format proposal)
docs/         specification, roadmap, this manual, user-manual draft
dist/         build output (gitignored)
```

The toolchain mirrors AZM: strict tsconfig, vitest, ESLint flat config,
Prettier, GPL-3.0-only.

## Commands

```sh
npm run build        # tsc to dist/
npm run typecheck
npm run lint
npm test             # includes generated-AZM assembly round trip
npm run format
node dist/src/cli.js examples/counter.glim   # .glim -> .asm
```
