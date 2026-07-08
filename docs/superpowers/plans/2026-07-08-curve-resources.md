# Curve Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add v0.3 `curve` resources that generate build-time byte lookup tables for ramp-driven motion.

**Architecture:** `curve Name preset steps N from A to B` is a top-level resource declaration parsed into `CurveDecl`. The generator computes byte values at build time, emits a page-aligned `Curve_<Name>` ROM table using AZM `.align 256` and `.db`, and user blocks index it with ordinary Z80. Curves are data resources, not change-flag cells.

**Tech Stack:** TypeScript, Vitest, AZM compile API, existing Glimmer parser/generator.

---

### Task 1: Parser And Model

**Files:**
- Modify: `src/model.ts`
- Modify: `src/parse.ts`
- Test: `test/parse.test.ts`

- [x] **Step 1: Write the failing parser test**

Add tests for:

```glim
curve SlideX ease_out steps 64 from 0 to 7
curve Linear linear steps 8
```

Expected model:

```ts
expect(program?.curves).toEqual([
  expect.objectContaining({ name: 'SlideX', preset: 'ease_out', steps: 64, from: 0, to: 7 }),
  expect.objectContaining({ name: 'Linear', preset: 'linear', steps: 8, from: 0, to: 7 }),
]);
```

Validation cases: unknown preset, steps outside 2..256, malformed numbers, from/to outside byte range, duplicate-name collision, and reserved `Curve_` prefix rejection.

- [x] **Step 2: Run parser tests to verify RED**

Run:

```sh
PATH=/Users/johnhardy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/vitest run test/parse.test.ts
```

Expected: fail because `curve` is currently an unknown statement.

- [x] **Step 3: Implement model and parser**

Add `CurveDecl` with preset, steps, from, to, and line. Parse:

```text
curve <Name> <preset> steps <N> [from <N> to <N>]
```

Default `from`/`to` to `0` and `steps - 1`. Accept presets: `linear`, `ease_in`, `ease_out`, `ease_in_out`, `sine`, `overshoot`, `anticipation`. Include curves in shared namespace checks and reserve `Curve_*`.

- [x] **Step 4: Run parser tests to verify GREEN**

Run the same parser test command. Expected: pass.

### Task 2: Generator

**Files:**
- Modify: `src/generate.ts`
- Modify: `src/index.ts`
- Test: `test/generate.test.ts`

- [x] **Step 1: Write the failing generator test**

Add tests that:

```ts
expect(source).toContain('.align  256');
expect(source).toContain('Curve_SlideX:');
expect(source).toContain('.db     0, 1, 2, 3, 4, 5, 6, 7');
```

Also test `ease_out steps 8 from 0 to 7` produces a monotonic table that starts at 0, ends at 7, and rises faster than linear early.

- [x] **Step 2: Run generator tests to verify RED**

Run:

```sh
PATH=/Users/johnhardy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/vitest run test/generate.test.ts
```

Expected: fail because curve tables are not emitted.

- [x] **Step 3: Implement curve generation**

Emit:

```asm
; --- curve resources ---
        .align  256
Curve_SlideX:
        .db     ...
```

Generate table values with `Math.round(from + eased * (to - from))`, clamped to 0..255. Format rows with up to 16 byte values per `.db` line.

- [x] **Step 4: Run generator tests to verify GREEN**

Run the same generator test command. Expected: pass.

### Task 3: Example And Docs

**Files:**
- Modify: `examples/slide.glim`
- Modify: `docs/manual/02-glim-format.md`
- Modify: `docs/reference/glim-grammar.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/v0.3.md`
- Modify: `docs/codebase/02-compile-pipeline.md`
- Modify: `docs/glimmer.md`

- [x] **Step 1: Convert Slide to an ease-out curve**

Add:

```glim
curve SlideX ease_out steps 64 from 0 to 7
```

Change `TrackDot` from shifting `Travel` to indexing `Curve_SlideX` with HL/DE and writing the loaded table value to `DotX`.

- [x] **Step 2: Update docs**

Document curves as build-time byte tables, not runtime math. Mention that page alignment makes future 8-bit indexed lookup patterns possible, while current examples use ordinary `ld hl,Curve_Name / add hl,de / ld a,(hl)`.

- [x] **Step 3: Run all verification**

Run:

```sh
git diff --check
PATH=/Users/johnhardy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/tsc -p tsconfig.json --noEmit
PATH=/Users/johnhardy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/vitest run
PATH=/Users/johnhardy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/eslint "src/**/*.ts" "test/**/*.ts"
```

Expected: all pass.

- [x] **Step 4: Commit**

```sh
git add src/model.ts src/parse.ts src/generate.ts src/index.ts test/parse.test.ts test/generate.test.ts examples/slide.glim docs/manual/02-glim-format.md docs/reference/glim-grammar.md docs/roadmap.md docs/plans/v0.3.md docs/codebase/02-compile-pipeline.md docs/glimmer.md docs/superpowers/plans/2026-07-08-curve-resources.md
git commit -m "feat: add curve resources"
```

### Task 4: High-Effort Review Loop

**Files:**
- No direct ownership; reviewer inspects the committed diff.

- [ ] **Step 1: Request high-effort subagent review**

Ask a reviewer to compare the feature commit against this plan and the existing v0.2/v0.3 runtime.

- [ ] **Step 2: Fix Critical and Important findings**

Use TDD for behavior changes, run verification, and commit fixes.

- [ ] **Step 3: Repeat review until no findings**

Do not start the next roadmap goal until review is clean.
