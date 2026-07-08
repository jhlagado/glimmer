/**
 * Parser for the Glimmer meta-source format (.glim).
 *
 * The format is line-oriented. Top-level statements:
 *
 *   program <Name>
 *   platform <name>          (optional; currently tec1g-mon3)
 *   display <name>           (optional; currently matrix8x8, needs platform)
 *   state <Name> : <byte|word|byte[N]> [= <value>] [changed]
 *   pulse <Name>
 *   timer <Name> : <byte|word> = <N> -> <PulseName> [once]
 *   ramp <Name> : byte steps <N> -> <PulseName>
 *   bind key <KEY_NAME> rising -> <PulseName>
 *   bind key <KEY_NAME> held period <N> -> <PulseName>   (tec1g only)
 *   compute <Name>   |  effect <Name>  |  render <Name>
 *       on <Cell>[, <Cell>...]           (the keyword is the phase:
 *       updates <Cell>[, <Cell>...]       compute=derive, effect=logic,
 *   begin                                 render=render; render blocks
 *       ...verbatim Z80 block body...     take no updates)
 *   end
 *
 * Comments start with ';' outside z80 bodies. Bodies are kept verbatim.
 */

import type {
  Binding,
  CurveDecl,
  CurvePreset,
  EffectDecl,
  EffectPhase,
  GlimmerDiagnostic,
  GlimmerProgram,
  PulseDecl,
  RampDecl,
  ShapeColor,
  ShapeDecl,
  SoundDecl,
  StateDecl,
  TimerDecl,
} from './model.js';
import type { ImportDecl } from './model.js';
import { FRAME_COUNT, TEC1G_KEY_CODES } from './model.js';

const PLATFORMS = ['tec1g-mon3'];
const DISPLAYS = ['matrix8x8'];

export interface ParseResult {
  program: GlimmerProgram | null;
  diagnostics: GlimmerDiagnostic[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATE_RE =
  /^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*((?:byte|word)(?:\[\S+\])?)(?:\s*=\s*(\S+))?(\s+changed)?$/;
const BIND_KEY_RE =
  /^bind\s+key\s+([A-Za-z_][A-Za-z0-9_]*)\s+(rising|held\s+period\s+\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/;
const TIMER_RE =
  /^timer\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(byte|word)\s*=\s*(\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)(\s+once)?$/;
const RAMP_RE =
  /^ramp\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*byte\s+steps\s+(\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/;
const PART_RE = /^part\s+"([^"]+)"$/;
const IMPORT_RE = /^import\s+"([^"]+)"$/;
const SOUND_RE = /^sound\s+([A-Za-z_][A-Za-z0-9_]*)\s+len\s+(\S+)\s+div\s+(\S+)$/;
const SHAPE_RE = /^shape\s+([A-Za-z_][A-Za-z0-9_]*)\s+color\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const SHAPE_ROW_RE = /^"([.X]+)"$/;
const CURVE_RE =
  /^curve\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s+steps\s+(\S+)(?:\s+from\s+(\S+)\s+to\s+(\S+))?$/;
const SHAPE_COLORS: readonly ShapeColor[] = [
  'red',
  'green',
  'blue',
  'yellow',
  'cyan',
  'magenta',
  'white',
];
const CURVE_PRESETS: readonly CurvePreset[] = [
  'linear',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'sine',
  'overshoot',
  'anticipation',
];

function stripComment(line: string): string {
  const semi = line.indexOf(';');
  return semi >= 0 ? line.slice(0, semi) : line;
}

export function parseNumber(text: string): number | null {
  let value: number;
  if (text.startsWith('$')) {
    const digits = text.slice(1);
    if (!/^[0-9A-Fa-f]+$/.test(digits)) return null;
    value = Number.parseInt(digits, 16);
  } else if (/^0x/i.test(text)) {
    const digits = text.slice(2);
    if (!/^[0-9A-Fa-f]+$/.test(digits)) return null;
    value = Number.parseInt(digits, 16);
  } else if (text.startsWith('%')) {
    const digits = text.slice(1);
    if (!/^[01]+$/.test(digits)) return null;
    value = Number.parseInt(digits, 2);
  } else if (/^[0-9]+$/.test(text)) {
    value = Number.parseInt(text, 10);
  } else {
    return null;
  }
  return Number.isNaN(value) ? null : value;
}

/** One parsed source file: an entry or a part, before program assembly. */
export interface ParsedUnit {
  kind: 'entry' | 'part';
  file: string | undefined;
  programName: string | null;
  platform: string | null;
  display: string | null;
  parts: ImportDecl[];
  imports: ImportDecl[];
  states: StateDecl[];
  pulses: PulseDecl[];
  timers: TimerDecl[];
  ramps: RampDecl[];
  sounds: SoundDecl[];
  curves: CurveDecl[];
  shapes: ShapeDecl[];
  bindings: Binding[];
  effects: EffectDecl[];
  diagnostics: GlimmerDiagnostic[];
}

export function parseUnit(
  source: string,
  opts: { kind: 'entry' | 'part'; file?: string } = { kind: 'entry' },
): ParsedUnit {
  const lines = source.split(/\r?\n/);
  const diagnostics: GlimmerDiagnostic[] = [];
  const error = (line: number, message: string): void => {
    diagnostics.push(
      opts.file === undefined ? { line, message } : { line, message, file: opts.file },
    );
  };
  const entryOnly = (lineNo: number, what: string): void => {
    error(
      lineNo,
      `Only the entry file declares ${what}; parts contribute cells, resources, bindings, and blocks.`,
    );
  };

  const parts: ImportDecl[] = [];
  const imports: ImportDecl[] = [];
  let programName: string | null = null;
  let platform: string | null = null;
  let display: string | null = null;
  const states: StateDecl[] = [];
  const pulses: PulseDecl[] = [];
  const timers: TimerDecl[] = [];
  const ramps: RampDecl[] = [];
  const sounds: SoundDecl[] = [];
  const curves: CurveDecl[] = [];
  const shapes: ShapeDecl[] = [];
  const bindings: Binding[] = [];
  const effects: EffectDecl[] = [];

  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const text = stripComment(lines[i] ?? '').trim();
    i += 1;
    if (text === '') continue;

    if (text.startsWith('part ')) {
      const match = PART_RE.exec(text);
      if (!match) {
        error(lineNo, `Invalid part declaration: "${text}". Expected: part "file.glim".`);
      } else if (opts.kind === 'part') {
        entryOnly(lineNo, 'parts');
      } else {
        parts.push({ path: match[1] as string, line: lineNo });
      }
      continue;
    }

    if (text.startsWith('import ')) {
      const match = IMPORT_RE.exec(text);
      if (!match) {
        error(lineNo, `Invalid import declaration: "${text}". Expected: import "module.asm".`);
      } else {
        imports.push({ path: match[1] as string, line: lineNo });
      }
      continue;
    }

    if (text.startsWith('program ')) {
      const name = text.slice('program '.length).trim();
      if (opts.kind === 'part') {
        entryOnly(lineNo, 'the program name');
        continue;
      }
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid program name "${name}".`);
      } else if (programName !== null) {
        error(lineNo, 'Duplicate program declaration.');
      } else {
        programName = name;
      }
      continue;
    }

    if (text.startsWith('platform ')) {
      const name = text.slice('platform '.length).trim();
      if (opts.kind === 'part') {
        entryOnly(lineNo, 'the platform');
        continue;
      }
      if (!PLATFORMS.includes(name)) {
        error(lineNo, `Unknown platform "${name}". Supported: ${PLATFORMS.join(', ')}.`);
      } else if (platform !== null) {
        error(lineNo, 'Duplicate platform declaration.');
      } else {
        platform = name;
      }
      continue;
    }

    if (text.startsWith('display ')) {
      const name = text.slice('display '.length).trim();
      if (opts.kind === 'part') {
        entryOnly(lineNo, 'the display');
        continue;
      }
      if (!DISPLAYS.includes(name)) {
        error(lineNo, `Unknown display "${name}". Supported: ${DISPLAYS.join(', ')}.`);
      } else if (display !== null) {
        error(lineNo, 'Duplicate display declaration.');
      } else {
        display = name;
      }
      continue;
    }

    if (text.startsWith('state ')) {
      const match = STATE_RE.exec(text);
      if (!match) {
        error(lineNo, `Invalid state declaration: "${text}".`);
        continue;
      }
      const [, name, type, initialText, changedFlag] = match;
      const arrayMatch = /^(byte|word)\[(\S+)\]$/.exec(type as string);
      let stateType = type as StateDecl['type'];
      let length: number | undefined;
      if (arrayMatch) {
        stateType = arrayMatch[1] as StateDecl['type'];
        if (stateType !== 'byte') {
          error(lineNo, `State ${name}: only byte arrays are supported.`);
          continue;
        }
        if (initialText !== undefined) {
          error(lineNo, `State ${name}: array initializers are not supported.`);
          continue;
        }
        const parsedLength = parseNumber(arrayMatch[2] as string);
        if (parsedLength === null || parsedLength < 1 || parsedLength > 256) {
          error(lineNo, `State ${name}: array length must be between 1 and 256.`);
          continue;
        }
        length = parsedLength;
      }
      let initial = 0;
      if (initialText !== undefined) {
        const parsed = parseNumber(initialText);
        if (parsed === null) {
          error(lineNo, `Invalid initial value "${initialText}" for state ${name}.`);
          continue;
        }
        initial = parsed;
      }
      const state: StateDecl = {
        name: name as string,
        type: stateType,
        initial,
        changedOnStart: changedFlag !== undefined,
        line: lineNo,
      };
      if (length !== undefined) state.length = length;
      states.push(state);
      continue;
    }

    if (text.startsWith('pulse ')) {
      const name = text.slice('pulse '.length).trim();
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid pulse name "${name}".`);
        continue;
      }
      pulses.push({ name, line: lineNo });
      continue;
    }

    if (text.startsWith('timer ')) {
      const match = TIMER_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid timer declaration: "${text}". Expected: timer <Name> : <byte|word> = <N> -> <Pulse> [once].`,
        );
        continue;
      }
      const initial = parseNumber(match[3] as string);
      if (initial === null || initial < 1) {
        error(lineNo, `Timer ${match[1]}: period must be a number of at least 1.`);
        continue;
      }
      timers.push({
        name: match[1] as string,
        type: match[2] as TimerDecl['type'],
        initial,
        target: match[4] as string,
        once: match[5] !== undefined,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('ramp ')) {
      const match = RAMP_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid ramp declaration: "${text}". Expected: ramp <Name> : byte steps <N> -> <Pulse>.`,
        );
        continue;
      }
      const steps = parseNumber(match[2] as string);
      if (steps === null || steps < 2 || steps > 256) {
        error(lineNo, `Ramp ${match[1]}: steps must be between 2 and 256.`);
        continue;
      }
      ramps.push({
        name: match[1] as string,
        steps,
        target: match[3] as string,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('sound ')) {
      const match = SOUND_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid sound declaration: "${text}". Expected: sound <Name> len <N> div <N>.`,
        );
        continue;
      }
      const len = parseNumber(match[2] as string);
      if (len === null || len < 1 || len > 255) {
        error(lineNo, `Sound ${match[1]}: len must be between 1 and 255 row ticks.`);
        continue;
      }
      const div = parseNumber(match[3] as string);
      if (div === null || div < 1 || div > 255) {
        error(lineNo, `Sound ${match[1]}: div must be between 1 and 255.`);
        continue;
      }
      sounds.push({ name: match[1] as string, len, div, line: lineNo });
      continue;
    }

    if (text.startsWith('curve ')) {
      const match = CURVE_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid curve declaration: "${text}". Expected: curve <Name> <preset> steps <N> [from <N> to <N>].`,
        );
        continue;
      }
      const name = match[1] as string;
      const preset = match[2] as string;
      if (!CURVE_PRESETS.includes(preset as CurvePreset)) {
        error(lineNo, `Curve ${name}: unknown preset "${preset}".`);
        continue;
      }
      const steps = parseNumber(match[3] as string);
      if (steps === null || steps < 2 || steps > 256) {
        error(lineNo, `Curve ${name}: steps must be between 2 and 256.`);
        continue;
      }
      const from = match[4] === undefined ? 0 : parseNumber(match[4]);
      const to = match[5] === undefined ? steps - 1 : parseNumber(match[5]);
      if (from === null || to === null || from < 0 || from > 255 || to < 0 || to > 255) {
        error(lineNo, `Curve ${name}: from/to values must be bytes between 0 and 255.`);
        continue;
      }
      curves.push({ name, preset: preset as CurvePreset, steps, from, to, line: lineNo });
      continue;
    }

    if (text.startsWith('shape ')) {
      const match = SHAPE_RE.exec(text);
      const rows: string[] = [];
      let sawEnd = false;

      while (i < lines.length) {
        const raw = lines[i] ?? '';
        i += 1;
        const rowText = stripComment(raw).trim();
        if (rowText === 'end') {
          sawEnd = true;
          break;
        }
        if (rowText === '') continue;
        const rowMatch = SHAPE_ROW_RE.exec(rowText);
        if (!rowMatch) {
          error(i, `Invalid shape row: "${rowText}". Expected a quoted row using only . and X.`);
          continue;
        }
        rows.push(rowMatch[1] as string);
      }

      if (!match) {
        error(
          lineNo,
          `Invalid shape declaration: "${text}". Expected: shape <Name> color <Color>.`,
        );
        continue;
      }
      const name = match[1] as string;
      const color = match[2] as string;
      if (!sawEnd) {
        error(lineNo, `Shape ${name}: missing end.`);
        continue;
      }
      if (!SHAPE_COLORS.includes(color as ShapeColor)) {
        error(lineNo, `Shape ${name}: unknown color "${color}".`);
        continue;
      }
      if (rows.length === 0) {
        error(lineNo, `Shape ${name}: must contain at least one row.`);
        continue;
      }
      const width = rows[0]?.length ?? 0;
      const badRow = rows.find((row) => row.length !== width);
      if (badRow !== undefined) {
        error(lineNo, `Shape ${name}: all rows must have width ${width}.`);
        continue;
      }
      if (width < 1 || width > 8 || rows.length < 1 || rows.length > 8) {
        error(lineNo, `Shape ${name}: width and height must be between 1 and 8.`);
        continue;
      }
      shapes.push({
        name,
        color: color as ShapeColor,
        rows,
        width,
        height: rows.length,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('bind ')) {
      const match = BIND_KEY_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid binding: "${text}". Expected: bind key <KEY> rising -> <Pulse>, or bind key <KEY> held period <N> -> <Pulse>.`,
        );
        continue;
      }
      const trigger = match[2] as string;
      if (trigger === 'rising') {
        bindings.push({
          kind: 'key',
          key: match[1] as string,
          edge: 'rising',
          target: match[3] as string,
          line: lineNo,
        });
      } else {
        const period = parseNumber(trigger.replace(/^held\s+period\s+/, ''));
        if (period === null || period < 1 || period > 255) {
          error(lineNo, `Held binding period must be between 1 and 255.`);
          continue;
        }
        bindings.push({
          kind: 'key',
          key: match[1] as string,
          edge: 'held',
          period,
          target: match[3] as string,
          line: lineNo,
        });
      }
      continue;
    }

    const blockMatch = /^(effect|compute|render)\s+(.*)$/.exec(text);
    if (blockMatch) {
      // Block declarations: the keyword is the phase.
      //   compute X  — derive phase; state computed from other state
      //   effect Y   — logic phase; ordinary game/app behaviour
      //   render Z   — render phase; state depicted, never updated
      const keyword = blockMatch[1] as 'effect' | 'compute' | 'render';
      const phase: EffectPhase =
        keyword === 'compute' ? 'derive' : keyword === 'render' ? 'render' : 'logic';
      const parts = (blockMatch[2] ?? '').trim().split(/\s+/);
      const name = parts[0] ?? '';
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid ${keyword} name "${name}".`);
      }
      if (parts.length > 1) {
        error(
          lineNo,
          `${keyword} takes a single name; unexpected "${parts[1]}". (Phase modifiers were replaced by the compute/render keywords.)`,
        );
      }
      const depends: string[] = [];
      const updates: string[] = [];

      // Header lines until the begin body opens.
      let sawBody = false;
      while (i < lines.length) {
        const headerLineNo = i + 1;
        const header = stripComment(lines[i] ?? '').trim();
        i += 1;
        if (header === '') continue;
        if (header === 'begin') {
          sawBody = true;
          break;
        }
        if (header.startsWith('on ')) {
          depends.push(...splitNames(header.slice('on '.length)));
          continue;
        }
        if (header.startsWith('updates ')) {
          updates.push(...splitNames(header.slice('updates '.length)));
          continue;
        }
        error(headerLineNo, `Unexpected line in ${keyword} ${name}: "${header}".`);
      }

      if (!sawBody) {
        error(lineNo, `${keyword} ${name} has no begin...end body.`);
        continue;
      }

      // Body lines are verbatim until a line containing only "end".
      const body: string[] = [];
      let sawEnd = false;
      while (i < lines.length) {
        const raw = lines[i] ?? '';
        i += 1;
        if (raw.trim() === 'end') {
          sawEnd = true;
          break;
        }
        body.push(raw);
      }
      if (!sawEnd) {
        error(lineNo, `${keyword} ${name}: missing end.`);
        continue;
      }

      if (depends.length === 0) {
        error(lineNo, `${keyword} ${name} has no "on" triggers; it would never run.`);
        continue;
      }
      // The keyword carries its constraints.
      if (keyword === 'render' && updates.length > 0) {
        error(
          lineNo,
          `render ${name} cannot update state cells: render blocks depict state. Use effect or compute.`,
        );
        continue;
      }
      if (keyword === 'compute' && updates.length === 0) {
        error(
          lineNo,
          `compute ${name} must declare updates: computing state is a compute block's purpose.`,
        );
        continue;
      }
      effects.push({ name, phase, depends, updates, body, line: lineNo });
      continue;
    }

    error(lineNo, `Unknown statement: "${text}".`);
  }

  return {
    kind: opts.kind,
    file: opts.file,
    programName,
    platform,
    display,
    parts,
    imports,
    states,
    pulses,
    timers,
    ramps,
    sounds,
    curves,
    shapes,
    bindings,
    effects,
    diagnostics,
  };
}

/**
 * Merge parsed units (the entry first, then its parts in declaration
 * order) into one program and validate the whole. Parts contribute to
 * the same single namespace: the compilation unit is the project.
 */
export function assembleProgram(units: ParsedUnit[]): ParseResult {
  const diagnostics: GlimmerDiagnostic[] = [];
  const entry = units[0];
  if (entry === undefined) {
    return { program: null, diagnostics: [{ line: 0, message: 'Nothing to assemble.' }] };
  }
  for (const unit of units) diagnostics.push(...unit.diagnostics);

  const fileOf = new Map<object, string | undefined>();
  const merged = {
    states: [] as StateDecl[],
    pulses: [] as PulseDecl[],
    timers: [] as TimerDecl[],
    ramps: [] as RampDecl[],
    sounds: [] as SoundDecl[],
    curves: [] as CurveDecl[],
    shapes: [] as ShapeDecl[],
    bindings: [] as Binding[],
    effects: [] as EffectDecl[],
    imports: [] as ImportDecl[],
  };
  for (const unit of units) {
    for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
      for (const decl of unit[key]) {
        fileOf.set(decl, unit.file);
        (merged[key] as object[]).push(decl);
      }
    }
  }
  const error = (owner: { line: number } | number, message: string): void => {
    if (typeof owner === 'number') {
      diagnostics.push({ line: owner, message, file: entry.file } as GlimmerDiagnostic);
      return;
    }
    const file = fileOf.get(owner);
    diagnostics.push(
      file === undefined ? { line: owner.line, message } : { line: owner.line, message, file },
    );
  };

  const { programName, platform, display } = entry;
  if (programName === null) {
    error(0, 'Missing program declaration.');
  }
  if (display !== null && platform === null) {
    error(0, `display ${display} requires a platform declaration.`);
  }
  if (platform !== null && display === null) {
    error(0, `platform ${platform} currently requires a display declaration.`);
  }
  if (platform === 'tec1g-mon3') {
    for (const binding of merged.bindings) {
      if (!TEC1G_KEY_CODES.has(binding.key)) {
        error(
          binding,
          `Unknown tec1g-mon3 key "${binding.key}". Known keys: KEY_0..KEY_F, KEY_PLUS, KEY_MINUS, KEY_GO, KEY_AD.`,
        );
      }
    }
  } else {
    for (const binding of merged.bindings) {
      if (binding.edge === 'held') {
        error(binding, 'Held bindings require platform tec1g-mon3.');
      }
    }
  }
  if (merged.sounds.length > 0 && !(platform === 'tec1g-mon3' && display === 'matrix8x8')) {
    for (const sound of merged.sounds) {
      error(sound, 'Sound cues require platform tec1g-mon3 with display matrix8x8.');
    }
  }
  if (merged.shapes.length > 0 && !(platform === 'tec1g-mon3' && display === 'matrix8x8')) {
    for (const shape of merged.shapes) {
      error(shape, 'Shape resources require platform tec1g-mon3 with display matrix8x8.');
    }
  }

  validateReferences(merged, diagnostics, (owner) => fileOf.get(owner));

  if (diagnostics.length > 0 || programName === null) {
    return { program: null, diagnostics };
  }
  return {
    program: {
      name: programName,
      platform,
      display,
      ...merged,
    },
    diagnostics,
  };
}

/**
 * Parse a single-file program. Multi-file programs (`part` declarations)
 * need file loading: use loadGlimmerProgram or the CLI.
 */
export function parseGlimmer(source: string): ParseResult {
  const unit = parseUnit(source, { kind: 'entry' });
  if (unit.parts.length > 0) {
    unit.diagnostics.push({
      line: unit.parts[0]?.line ?? 0,
      message:
        'part declarations need file loading: compile with the glimmer CLI (or loadGlimmerProgram).',
    });
  }
  return assembleProgram([unit]);
}

function splitNames(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

function validateReferences(
  parts: Pick<
    GlimmerProgram,
    | 'states'
    | 'pulses'
    | 'timers'
    | 'ramps'
    | 'sounds'
    | 'curves'
    | 'shapes'
    | 'bindings'
    | 'effects'
  >,
  diagnostics: GlimmerDiagnostic[],
  fileOf: (owner: object) => string | undefined = () => undefined,
): void {
  const error = (owner: { line: number }, message: string): void => {
    const file = fileOf(owner);
    diagnostics.push(
      file === undefined ? { line: owner.line, message } : { line: owner.line, message, file },
    );
  };

  // All declared names — states, pulses, effects (and future constructs) —
  // share one namespace: they all project into one flat AZM symbol space.
  // Names that would collide with generated or profile symbols are
  // reserved so the diagnostic points at the .glim line, with AZM's
  // global-uniqueness check as the backstop.
  const declaredNames = new Set<string>();
  const declare = (owner: { line: number }, name: string, kind: string): void => {
    if (declaredNames.has(name)) {
      error(owner, `Duplicate name "${name}": all declared names share one namespace.`);
    }
    declaredNames.add(name);
    if (/^(Glim|Snd_|Curve_|Shape_|CHG_|__)/.test(name) || RESERVED_NAMES.has(name)) {
      error(
        owner,
        `Reserved name "${name}": it belongs to the generated runtime (${kind}s cannot use Glim*/Snd_*/Curve_*/Shape_*/CHG_*/__* or runtime symbols).`,
      );
    }
  };

  for (const state of parts.states) declare(state, state.name, 'state');
  for (const pulse of parts.pulses) declare(pulse, pulse.name, 'pulse');
  for (const timer of parts.timers) declare(timer, timer.name, 'timer');
  for (const ramp of parts.ramps) declare(ramp, ramp.name, 'ramp');
  for (const sound of parts.sounds) declare(sound, sound.name, 'sound');
  for (const curve of parts.curves) declare(curve, curve.name, 'curve');
  for (const shape of parts.shapes) declare(shape, shape.name, 'shape');
  for (const effect of parts.effects) declare(effect, effect.name, 'effect');

  // `on` accepts anything with a change flag: states, pulses, ramps, and
  // the built-in FrameCount. `updates` accepts what code may write:
  // states, timers (the period register), and ramps (retriggering).
  // Timer cells carry no flag — the pulse is the notification — so they
  // cannot appear in `on`.
  const pulseNames = new Set(parts.pulses.map((pulse) => pulse.name));
  const timerNames = new Set(parts.timers.map((timer) => timer.name));
  const onNames = new Set([
    ...parts.states.map((s) => s.name),
    ...pulseNames,
    ...parts.ramps.map((r) => r.name),
    FRAME_COUNT,
  ]);
  const updateNames = new Set([
    ...parts.states.map((s) => s.name),
    ...timerNames,
    ...parts.ramps.map((r) => r.name),
  ]);

  for (const binding of parts.bindings) {
    if (!pulseNames.has(binding.target)) {
      error(binding, `Binding target "${binding.target}" is not a declared pulse.`);
    }
  }
  for (const timer of parts.timers) {
    if (!pulseNames.has(timer.target)) {
      error(timer, `Timer ${timer.name} fires "${timer.target}", which is not a declared pulse.`);
    }
  }
  for (const ramp of parts.ramps) {
    if (!pulseNames.has(ramp.target)) {
      error(ramp, `Ramp ${ramp.name} fires "${ramp.target}", which is not a declared pulse.`);
    }
  }

  for (const effect of parts.effects) {
    for (const dep of effect.depends) {
      if (!onNames.has(dep)) {
        const hint = timerNames.has(dep)
          ? ` (timer cells carry no change flag; trigger on the timer's pulse instead)`
          : '';
        error(effect, `Effect ${effect.name} triggers on undeclared cell "${dep}".${hint}`);
      }
    }
    for (const target of effect.updates) {
      if (!updateNames.has(target)) {
        error(effect, `Effect ${effect.name} updates undeclared state "${target}".`);
      }
    }
  }
}

/** Symbols the generated runtime and profiles own; user names must avoid them. */
const RESERVED_NAMES = new Set([
  ...Array.from({ length: 4 }, (_, bank) => `Changed${bank}`),
  ...Array.from({ length: 4 }, (_, bank) => `Raised${bank}`),
  ...Array.from({ length: 4 }, (_, bank) => `Next${bank}`),
  'MainLoop',
  'Framebuffer',
  'PrevKeys',
  'ScanFrame',
  'MxMask',
  'FbPlot',
  'FbClear',
  'ScanDwellPeriod',
  'ApiScanKeys',
  'PortRow',
  'PortRed',
  'PortGreen',
  'PortBlue',
  'COLOR_RED',
  'COLOR_GREEN',
  'COLOR_BLUE',
  'COLOR_YELLOW',
  'COLOR_CYAN',
  'COLOR_MAGENTA',
  'COLOR_WHITE',
  'API_ReadKeys',
  'API_DrawChar',
  'API_FlushDisplay',
  'API_InitDisplay',
  'FrameCount',
  'PortDigits',
  'PortSegs',
  'SpeakerBit',
  'SpeakerPort',
  'SoundTimer',
  'SndDivReload',
  'SndDivCount',
  'SndStart',
  'SndService',
  'HudScanDig',
  'HudBlankDig',
  'HudWriteU16',
  'HudDecDigit',
  'HudSegBuffer',
  'HudScanIndex',
  'HudMaskTbl',
  'HudGlyphTbl',
  'ShapeDraw',
  'ShapePtr',
  'ShapeBaseX',
  'ShapeBaseY',
  'ShapeWidth',
  'ShapeHeight',
  'ShapeColor',
  'ShapeRowMask',
  'ShapeRowIndex',
  'ShapeColIndex',
  'ShapeDrawRow',
  'ShapeDrawCol',
  'ShapeDrawSkipPixel',
  'ShapeDrawNextRow',
]);
