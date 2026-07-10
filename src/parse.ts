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
  CardDecl,
  CurveDecl,
  CurvePreset,
  EffectDecl,
  EffectPhase,
  GlimmerDiagnostic,
  GlimmerProgram,
  PulseDecl,
  RampDecl,
  RoutineDecl,
  ShapeColor,
  ShapeDecl,
  ShapeRotation,
  ShapeRotationSet,
  SoundDecl,
  SpriteDecl,
  StateDecl,
  TextDecl,
  TileDecl,
  TimerDecl,
  TypeDecl,
  VdpColor,
  TypeFieldDecl,
} from './model.js';
import type { ImportDecl } from './model.js';
import { CURRENT_CARD, FRAME_COUNT, TEC1G_KEY_CODES } from './model.js';

const PLATFORMS = ['tec1g-mon3'];
const DISPLAYS = ['matrix8x8', 'tms9918'];

export interface ParseResult {
  program: GlimmerProgram | null;
  diagnostics: GlimmerDiagnostic[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATE_RE =
  /^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\[\S+\])?)(?:\s*=\s*(\S+))?(\s+changed)?$/;
/** AZM type expression: TypeName or TypeName[N] (byte/word/addr included). */
const TYPE_EXPR_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/;
/** A layout field type: byte/word/addr, a positive byte count, or a type expression. */
const FIELD_TYPE_RE = /^(?:byte|word|addr|[1-9][0-9]*|[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)$/;
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
const TEXT_RE = /^text\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"$/;
const SPRITE_RE = /^sprite\s+([A-Za-z_][A-Za-z0-9_]*)\s+color\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const TILE_RE =
  /^tile\s+([A-Za-z_][A-Za-z0-9_]*)\s+color\s+([A-Za-z_][A-Za-z0-9_]*)\s+on\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const VDP_COLORS: readonly VdpColor[] = [
  'transparent', 'black', 'medgreen', 'lightgreen', 'darkblue', 'lightblue',
  'darkred', 'cyan', 'medred', 'lightred', 'darkyellow', 'lightyellow',
  'darkgreen', 'magenta', 'gray', 'white',
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
  types: TypeDecl[];
  states: StateDecl[];
  pulses: PulseDecl[];
  timers: TimerDecl[];
  ramps: RampDecl[];
  sounds: SoundDecl[];
  curves: CurveDecl[];
  shapes: ShapeDecl[];
  sprites: SpriteDecl[];
  tiles: TileDecl[];
  texts: TextDecl[];
  bindings: Binding[];
  effects: EffectDecl[];
  routines: RoutineDecl[];
  cards: CardDecl[];
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
  const types: TypeDecl[] = [];
  const states: StateDecl[] = [];
  const pulses: PulseDecl[] = [];
  const timers: TimerDecl[] = [];
  const ramps: RampDecl[] = [];
  const sounds: SoundDecl[] = [];
  const curves: CurveDecl[] = [];
  const shapes: ShapeDecl[] = [];
  const sprites: SpriteDecl[] = [];
  const tiles: TileDecl[] = [];
  const texts: TextDecl[] = [];
  const bindings: Binding[] = [];
  const effects: EffectDecl[] = [];
  const routines: RoutineDecl[] = [];
  const cards: CardDecl[] = [];
  let currentCard: string | null = null;

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
      const [, name, typeText, initialText, changedFlag] = match;
      const typeMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\S+)\])?$/.exec(typeText as string);
      if (!typeMatch) {
        error(lineNo, `State ${name}: invalid type "${typeText}".`);
        continue;
      }
      const baseType = typeMatch[1] as string;
      const lengthText = typeMatch[2];
      const isScalar = baseType === 'byte' || baseType === 'word';

      let length: number | undefined;
      if (lengthText !== undefined) {
        if (isScalar && baseType !== 'byte') {
          error(lineNo, `State ${name}: only byte arrays are supported.`);
          continue;
        }
        const parsedLength = parseNumber(lengthText);
        if (parsedLength === null || parsedLength < 1 || parsedLength > 256) {
          error(lineNo, `State ${name}: array length must be between 1 and 256.`);
          continue;
        }
        length = parsedLength;
      } else if (typeText !== baseType) {
        error(lineNo, `State ${name}: invalid type "${typeText}".`);
        continue;
      }

      if (initialText !== undefined && (length !== undefined || !isScalar)) {
        error(
          lineNo,
          `State ${name}: ${isScalar ? 'array' : 'typed'} state takes no initializer (storage is zero-filled).`,
        );
        continue;
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
        type: isScalar ? (baseType as StateDecl['type']) : 'byte',
        initial,
        changedOnStart: changedFlag !== undefined,
        line: lineNo,
      };
      if (!isScalar) state.typeName = baseType;
      if (length !== undefined) state.length = length;
      states.push(state);
      continue;
    }

    if (text.startsWith('type ')) {
      const rest = text.slice('type '.length).trim();
      const aliasMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)$/.exec(rest);
      if (aliasMatch) {
        const [, name, expr] = aliasMatch;
        if (!TYPE_EXPR_RE.test(expr as string)) {
          error(lineNo, `Type ${name}: invalid alias target "${expr}".`);
          continue;
        }
        types.push({ name: name as string, alias: expr as string, fields: [], line: lineNo });
        continue;
      }
      if (!IDENT.test(rest)) {
        error(lineNo, `Invalid type declaration: "${text}". Expected: type <Name> or type <Name> = <TypeExpr>.`);
        continue;
      }
      // Field lines (name : fieldtype) until a line containing only "end".
      const fields: TypeFieldDecl[] = [];
      const fieldNames = new Set<string>();
      let sawEnd = false;
      let malformed = false;
      while (i < lines.length) {
        const fieldLineNo = i + 1;
        const fieldText = stripComment(lines[i] ?? '').trim();
        i += 1;
        if (fieldText === '') continue;
        if (fieldText === 'end') {
          sawEnd = true;
          break;
        }
        // A new top-level statement means the closing `end` was forgotten;
        // hand the line back rather than swallowing the next declaration.
        if (
          /^(program|platform|display|part|import|type|state|pulse|timer|ramp|sound|curve|shape|bind|effect|compute|render|routine|card)\b/.test(
            fieldText,
          )
        ) {
          i -= 1;
          break;
        }
        const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S+)$/.exec(fieldText);
        if (!fieldMatch || !FIELD_TYPE_RE.test(fieldMatch[2] as string)) {
          error(
            fieldLineNo,
            `Type ${rest}: invalid field "${fieldText}". Expected: <name> : <byte|word|addr|N|Type[N]>.`,
          );
          malformed = true;
          continue;
        }
        const fieldName = fieldMatch[1] as string;
        if (fieldNames.has(fieldName)) {
          error(fieldLineNo, `Type ${rest}: duplicate field "${fieldName}".`);
          malformed = true;
          continue;
        }
        fieldNames.add(fieldName);
        fields.push({ name: fieldName, type: fieldMatch[2] as string, line: fieldLineNo });
      }
      if (!sawEnd) {
        error(lineNo, `Type ${rest}: missing end.`);
        continue;
      }
      if (fields.length === 0 && !malformed) {
        error(lineNo, `Type ${rest} has no fields.`);
        continue;
      }
      if (malformed) continue;
      types.push({ name: rest, fields, line: lineNo });
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
      const once = match[5] !== undefined;
      // A once timer may start at 0: idle until code writes the
      // countdown (the armed-on-demand pattern). Oscillators need a
      // real period.
      if (initial === null || (!once && initial < 1)) {
        error(lineNo, `Timer ${match[1]}: period must be a number of at least 1.`);
        continue;
      }
      timers.push({
        name: match[1] as string,
        type: match[2] as TimerDecl['type'],
        initial,
        target: match[4] as string,
        once,
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

    if (text.startsWith('text ')) {
      const match = TEXT_RE.exec(text);
      if (!match) {
        error(lineNo, `Invalid text declaration: "${text}". Expected: text <Name> "STRING".`);
        continue;
      }
      texts.push({ name: match[1] as string, value: match[2] as string, line: lineNo });
      continue;
    }

    if (text.startsWith('sprite ') || text.startsWith('tile ')) {
      const isSprite = text.startsWith('sprite ');
      const match = isSprite ? SPRITE_RE.exec(text) : TILE_RE.exec(text);
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
          error(i, `Invalid ${isSprite ? 'sprite' : 'tile'} row: "${rowText}". Expected a quoted row using only . and X.`);
          continue;
        }
        rows.push(rowMatch[1] as string);
      }
      if (!match) {
        error(
          lineNo,
          isSprite
            ? `Invalid sprite declaration: "${text}". Expected: sprite <Name> color <VdpColor>.`
            : `Invalid tile declaration: "${text}". Expected: tile <Name> color <Fg> on <Bg>.`,
        );
        continue;
      }
      const name = match[1] as string;
      if (!sawEnd) {
        error(lineNo, `${isSprite ? 'Sprite' : 'Tile'} ${name}: missing end.`);
        continue;
      }
      if (rows.length !== 8 || rows.some((row) => row.length !== 8)) {
        error(lineNo, `${isSprite ? 'Sprite' : 'Tile'} ${name}: needs exactly 8 rows of 8 pixels.`);
        continue;
      }
      const colors = (isSprite ? [match[2]] : [match[2], match[3]]) as string[];
      const badColor = colors.find((c) => !VDP_COLORS.includes(c as VdpColor));
      if (badColor !== undefined) {
        error(lineNo, `${isSprite ? 'Sprite' : 'Tile'} ${name}: unknown colour "${badColor}".`);
        continue;
      }
      if (isSprite) {
        sprites.push({ name, color: colors[0] as VdpColor, rows, line: lineNo });
      } else {
        tiles.push({
          name,
          fg: colors[0] as VdpColor,
          bg: colors[1] as VdpColor,
          rows,
          line: lineNo,
        });
      }
      continue;
    }

    if (text.startsWith('shape ')) {
      const match = SHAPE_RE.exec(text);
      const rows: string[] = [];
      // Rotational form: rotN groups (optionally rotN = rotM aliases).
      const rotGroups: string[][] = [];
      const rotAliases = new Map<number, number>();
      let currentRot: string[] | null = null;
      let rotCount = 0;
      let rotError = false;
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
        const aliasMatch = /^rot([0-3])\s*=\s*rot([0-3])$/.exec(rowText);
        if (aliasMatch) {
          const n = Number(aliasMatch[1]);
          const m = Number(aliasMatch[2]);
          if (n !== rotCount || m >= rotCount || rotAliases.has(m)) {
            error(
              i,
              `Shape rotation alias must name the next rotation and an earlier distinct one: "${rowText}".`,
            );
            rotError = true;
          } else {
            rotAliases.set(n, m);
          }
          rotCount += 1;
          currentRot = null;
          continue;
        }
        const rotMatch = /^rot([0-3])\b\s*(.*)$/.exec(rowText);
        if (rotMatch) {
          const n = Number(rotMatch[1]);
          if (n !== rotCount) {
            error(i, `Shape rotations must be declared in order: expected rot${rotCount}, got rot${n}.`);
            rotError = true;
          }
          rotCount += 1;
          currentRot = [];
          rotGroups.push(currentRot);
          const rest = (rotMatch[2] ?? '').trim();
          if (rest !== '') {
            const restMatch = SHAPE_ROW_RE.exec(rest);
            if (!restMatch) {
              error(i, `Invalid shape row: "${rest}". Expected a quoted row using only . and X.`);
              rotError = true;
            } else {
              currentRot.push(restMatch[1] as string);
            }
          }
          continue;
        }
        const rowMatch = SHAPE_ROW_RE.exec(rowText);
        if (!rowMatch) {
          error(i, `Invalid shape row: "${rowText}". Expected a quoted row using only . and X.`);
          continue;
        }
        if (currentRot !== null) {
          currentRot.push(rowMatch[1] as string);
        } else if (rotCount > 0) {
          error(i, `Shape row outside a rotation group (rot0..rot3 shapes take rows inside groups).`);
          rotError = true;
        } else {
          rows.push(rowMatch[1] as string);
        }
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
      if (rotCount > 0) {
        if (rotError) continue;
        if (rows.length > 0) {
          error(lineNo, `Shape ${name}: mixes plain rows with rotation groups.`);
          continue;
        }
        const shape = buildRotationalShape(name, color as ShapeColor, rotGroups, rotAliases, rotCount, lineNo, error);
        if (shape !== null) shapes.push(shape);
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

    if (text.startsWith('routine ')) {
      const name = text.slice('routine '.length).trim();
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid routine name "${name}".`);
        continue;
      }
      // Routines have no triggers and no dispatch: the header is bare.
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
        error(
          headerLineNo,
          header.startsWith('on ') || header.startsWith('updates ')
            ? `Routine ${name} takes no "${header.split(/\s/)[0]}": routines have no triggers or dispatch — they are called from block bodies.`
            : `Unexpected line in routine ${name}: "${header}".`,
        );
      }
      if (!sawBody) {
        error(lineNo, `routine ${name} has no begin...end body.`);
        continue;
      }
      const bodyLine = i + 1;
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
        error(lineNo, `routine ${name}: missing end.`);
        continue;
      }
      routines.push({ name, body, line: lineNo, bodyLine });
      continue;
    }

    if (text.startsWith('card ')) {
      const name = text.slice('card '.length).trim();
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid card name "${name}".`);
        continue;
      }
      // A card line starts a section: everything after it belongs to
      // that card until the next card line or end of file. Repeating a
      // card name re-enters its section (also across parts).
      if (!cards.some((card) => card.name === name)) {
        cards.push({ name, line: lineNo });
      }
      currentCard = name;
      continue;
    }

    const blockMatch = /^(effect|compute|render|enter)\s+(.*)$/.exec(text);
    if (blockMatch) {
      // Block declarations: the keyword is the phase.
      //   compute X  — derive phase; state computed from other state
      //   effect Y   — logic phase; ordinary game/app behaviour
      //   render Z   — render phase; state depicted, never updated
      //   enter W    — logic phase; runs once on entry to its card
      const keyword = blockMatch[1] as 'effect' | 'compute' | 'render' | 'enter';
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
      if (keyword === 'enter' && currentCard === null) {
        error(lineNo, `enter ${name} must be inside a card section: enter runs on card entry.`);
        continue;
      }
      const depends: string[] = [];
      const updates: string[] = [];
      let gotoTarget: string | undefined;

      // Header lines until the begin body opens. A block with goto may
      // close with a bare end instead: header-only routing blocks.
      let sawBody = false;
      let bodyOptional = false;
      while (i < lines.length) {
        const headerLineNo = i + 1;
        const header = stripComment(lines[i] ?? '').trim();
        i += 1;
        if (header === '') continue;
        if (header === 'begin') {
          sawBody = true;
          break;
        }
        if (header === 'end' && gotoTarget !== undefined) {
          bodyOptional = true;
          break;
        }
        if (header.startsWith('on ')) {
          if (keyword === 'enter') {
            error(
              headerLineNo,
              `enter ${name} takes no "on": card entry is its trigger (CurrentCard changing to ${currentCard ?? 'its card'}).`,
            );
            continue;
          }
          depends.push(...splitNames(header.slice('on '.length)));
          continue;
        }
        if (header.startsWith('updates ')) {
          updates.push(...splitNames(header.slice('updates '.length)));
          continue;
        }
        if (header.startsWith('goto ')) {
          const target = header.slice('goto '.length).trim();
          if (!IDENT.test(target)) {
            error(headerLineNo, `Invalid goto target "${target}" in ${keyword} ${name}.`);
            continue;
          }
          if (keyword === 'render') {
            error(
              headerLineNo,
              `render ${name} cannot goto: render blocks depict state. Route from effect or enter.`,
            );
            continue;
          }
          if (gotoTarget !== undefined) {
            error(headerLineNo, `${keyword} ${name} declares more than one goto.`);
            continue;
          }
          gotoTarget = target;
          continue;
        }
        error(headerLineNo, `Unexpected line in ${keyword} ${name}: "${header}".`);
      }

      if (!sawBody && !bodyOptional) {
        error(lineNo, `${keyword} ${name} has no begin...end body.`);
        continue;
      }

      // Body lines are verbatim until a line containing only "end".
      // The first body line's source position anchors the debug map.
      const bodyLine = i + 1;
      const body: string[] = [];
      if (sawBody) {
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
      }

      if (keyword === 'enter') {
        // Card entry is the trigger: CurrentCard changed to this card.
        depends.push(CURRENT_CARD);
      } else if (depends.length === 0) {
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
      const effect: EffectDecl = { name, phase, depends, updates, body, line: lineNo, bodyLine };
      if (currentCard !== null) effect.card = currentCard;
      if (keyword === 'enter') effect.enter = true;
      if (gotoTarget !== undefined) effect.goto = gotoTarget;
      effects.push(effect);
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
    types,
    states,
    pulses,
    timers,
    ramps,
    sounds,
    curves,
    shapes,
    sprites,
    tiles,
    texts,
    bindings,
    effects,
    routines,
    cards,
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
    types: [] as TypeDecl[],
    states: [] as StateDecl[],
    pulses: [] as PulseDecl[],
    timers: [] as TimerDecl[],
    ramps: [] as RampDecl[],
    sounds: [] as SoundDecl[],
    curves: [] as CurveDecl[],
    shapes: [] as ShapeDecl[],
    sprites: [] as SpriteDecl[],
    tiles: [] as TileDecl[],
    texts: [] as TextDecl[],
    bindings: [] as Binding[],
    effects: [] as EffectDecl[],
    routines: [] as RoutineDecl[],
    cards: [] as CardDecl[],
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
  // Blocks carry their declaring file into the model: the debug-map
  // rewrite attributes generated body lines back to the right .glim file.
  for (const effect of merged.effects) {
    const file = fileOf.get(effect);
    if (file !== undefined) effect.file = file;
  }
  for (const routine of merged.routines) {
    const file = fileOf.get(routine);
    if (file !== undefined) routine.file = file;
  }
  // Card sections may repeat (re-entering a card, or a part contributing
  // blocks to a card the entry declared): one card per name, in order of
  // first appearance. The first card is the one the program starts in.
  const seenCards = new Set<string>();
  merged.cards = merged.cards.filter((card) => {
    if (seenCards.has(card.name)) return false;
    seenCards.add(card.name);
    return true;
  });
  // goto is an update of CurrentCard: fold it into `updates` so change
  // masks, rollover, and the dependency report all see the real dataflow.
  for (const effect of merged.effects) {
    if (effect.goto !== undefined && !effect.updates.includes(CURRENT_CARD)) {
      effect.updates.push(CURRENT_CARD);
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
      if (binding.key === 'any') {
        if (binding.edge === 'held') {
          error(binding, 'bind key any supports rising only: "any" has no single key to autorepeat.');
        }
        continue;
      }
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
      if (binding.key === 'any') {
        error(binding, 'bind key any requires platform tec1g-mon3.');
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
  if (
    (merged.sprites.length > 0 || merged.tiles.length > 0) &&
    !(platform === 'tec1g-mon3' && display === 'tms9918')
  ) {
    for (const decl of [...merged.sprites, ...merged.tiles]) {
      error(decl, 'Sprite and tile resources require platform tec1g-mon3 with display tms9918.');
    }
  }
  if (merged.texts.length > 0 && platform !== 'tec1g-mon3') {
    for (const textDecl of merged.texts) {
      error(textDecl, 'Text resources require platform tec1g-mon3 (the board LCD).');
    }
  }
  if (merged.sprites.length > 31) {
    error(merged.sprites[31] as SpriteDecl, 'At most 31 sprites (slot 31 stays the hidden terminator).');
  }

  validateReferences(merged, diagnostics, (owner) => fileOf.get(owner));

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity !== 'warning');
  if (hasErrors || programName === null) {
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
    | 'types'
    | 'states'
    | 'pulses'
    | 'timers'
    | 'ramps'
    | 'sounds'
    | 'curves'
    | 'shapes'
    | 'sprites'
    | 'tiles'
    | 'texts'
    | 'bindings'
    | 'effects'
    | 'routines'
    | 'cards'
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
  const warn = (owner: { line: number }, message: string): void => {
    const file = fileOf(owner);
    diagnostics.push({
      line: owner.line,
      message,
      severity: 'warning',
      ...(file === undefined ? {} : { file }),
    });
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
    if (/^(Glim|Snd_|Curve_|Shape_|ShapeRot_|ShapeId_|CHG_|__|KEY_|API_|VC_|VDP_|VRAM_)/.test(name) || RESERVED_NAMES.has(name)) {
      error(
        owner,
        `Reserved name "${name}": it belongs to the generated runtime (${kind}s cannot use Glim*/Snd_*/Curve_*/Shape_*/CHG_*/__* or runtime symbols).`,
      );
    }
  };

  for (const type of parts.types) declare(type, type.name, 'type');
  for (const state of parts.states) declare(state, state.name, 'state');
  for (const pulse of parts.pulses) declare(pulse, pulse.name, 'pulse');
  for (const timer of parts.timers) declare(timer, timer.name, 'timer');
  for (const ramp of parts.ramps) declare(ramp, ramp.name, 'ramp');
  for (const sound of parts.sounds) declare(sound, sound.name, 'sound');
  for (const curve of parts.curves) declare(curve, curve.name, 'curve');
  for (const shape of parts.shapes) declare(shape, shape.name, 'shape');
  for (const sprite of parts.sprites) declare(sprite, sprite.name, 'sprite');
  for (const tile of parts.tiles) declare(tile, tile.name, 'tile');
  for (const textDecl of parts.texts) declare(textDecl, textDecl.name, 'text');
  for (const effect of parts.effects) declare(effect, effect.name, 'effect');
  for (const routine of parts.routines) declare(routine, routine.name, 'routine');

  // `on` accepts anything with a change flag: states, pulses, ramps, and
  // the built-in FrameCount. `updates` accepts what code may write:
  // states, timers (the period register), and ramps (retriggering).
  // Timer cells carry no flag — the pulse is the notification — so they
  // cannot appear in `on`.
  const pulseNames = new Set(parts.pulses.map((pulse) => pulse.name));
  const timerNames = new Set(parts.timers.map((timer) => timer.name));
  const hasCards = parts.cards.length > 0;
  const cardNames = new Set(parts.cards.map((card) => card.name));
  const onNames = new Set([
    ...parts.states.map((s) => s.name),
    ...pulseNames,
    ...parts.ramps.map((r) => r.name),
    FRAME_COUNT,
    ...(hasCards ? [CURRENT_CARD] : []),
  ]);
  const updateNames = new Set([
    ...parts.states.map((s) => s.name),
    ...timerNames,
    ...parts.ramps.map((r) => r.name),
    ...(hasCards ? [CURRENT_CARD] : []),
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

  for (const effect of parts.effects) {
    if (effect.goto !== undefined && !cardNames.has(effect.goto)) {
      error(effect, `${effect.name}: goto target "${effect.goto}" is not a declared card.`);
    }
  }

  // Lint: a body that stores into a flag-carrying cell it does not
  // declare in `updates` silently skips change propagation — the
  // dependency report and downstream triggers would lie. Direct
  // `ld (Cell),` stores only; writes through pointer registers are
  // invisible to a text scan.
  const storeRe = /\bld\s+\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*,/i;
  for (const effect of parts.effects) {
    const missing = new Set<string>();
    for (const line of effect.body) {
      const semi = line.indexOf(';');
      const code = semi >= 0 ? line.slice(0, semi) : line;
      const match = storeRe.exec(code);
      if (!match) continue;
      const cell = match[1] as string;
      if (!updateNames.has(cell)) continue;
      if (effect.updates.includes(cell)) continue;
      missing.add(cell);
    }
    for (const cell of missing) {
      warn(
        effect,
        `${effect.name} writes ${cell} but does not declare "updates ${cell}": the change flag will not be raised and dependent blocks will not run.`,
      );
    }
  }

  validateTypeReferences(parts.types, parts.states, error);
}

/**
 * Validate rot0..rotN groups and build the rotation set. Declared
 * rotations (groups and aliases) fill positions 0..count-1; positions
 * beyond that cycle through the declared ones (r mod count), which
 * covers the corpus pieces: I declares two rotations, O one, T all
 * four, S/Z three plus a rot3 = rot1 alias.
 */
function buildRotationalShape(
  name: string,
  color: ShapeColor,
  rotGroups: string[][],
  rotAliases: Map<number, number>,
  rotCount: number,
  lineNo: number,
  error: (line: number, message: string) => void,
): ShapeDecl | null {
  const distinct: ShapeRotation[] = [];
  for (const rows of rotGroups) {
    if (rows.length === 0 || rows.length > 4) {
      error(lineNo, `Shape ${name}: each rotation needs 1 to 4 rows.`);
      return null;
    }
    const width = rows[0]?.length ?? 0;
    if (rows.some((row) => row.length !== width)) {
      error(lineNo, `Shape ${name}: all rows in a rotation must have the same width.`);
      return null;
    }
    if (width < 1 || width > 8) {
      error(lineNo, `Shape ${name}: rotation width must be between 1 and 8.`);
      return null;
    }
    let right = -1;
    for (const row of rows) {
      for (let col = 0; col < row.length; col += 1) {
        if (row[col] === 'X' && col > right) right = col;
      }
    }
    if (right < 0) {
      error(lineNo, `Shape ${name}: a rotation has no set pixels.`);
      return null;
    }
    distinct.push({ rows: [...rows], width, height: rows.length, right });
  }

  // Resolve declared positions to distinct indexes: groups in order,
  // aliases to their target's resolution.
  const resolved: number[] = [];
  let nextGroup = 0;
  for (let r = 0; r < rotCount; r += 1) {
    const aliasTarget = rotAliases.get(r);
    if (aliasTarget !== undefined) {
      resolved.push(resolved[aliasTarget] as number);
    } else {
      resolved.push(nextGroup);
      nextGroup += 1;
    }
  }
  const map = [0, 1, 2, 3].map((r) => resolved[r % rotCount] as number) as [
    number,
    number,
    number,
    number,
  ];
  const base = distinct[0] as ShapeRotation;
  return {
    name,
    color,
    rows: [...base.rows],
    width: base.width,
    height: base.height,
    line: lineNo,
    rotations: { distinct, map },
  };
}

/** Base name of a field/alias type expression, if it names a layout type. */
function typeExprBaseName(expr: string): string | undefined {
  const base = expr.replace(/\[\d+\]$/, '');
  if (base === 'byte' || base === 'word' || base === 'addr') return undefined;
  return /^[1-9][0-9]*$/.test(base) ? undefined : base;
}

function validateTypeReferences(
  types: readonly TypeDecl[],
  states: readonly StateDecl[],
  error: (owner: { line: number }, message: string) => void,
): void {
  const typeByName = new Map(types.map((type) => [type.name, type]));

  for (const state of states) {
    if (state.typeName !== undefined && !typeByName.has(state.typeName)) {
      error(state, `State ${state.name}: unknown type "${state.typeName}".`);
    }
  }
  for (const type of types) {
    if (type.alias !== undefined) {
      const base = typeExprBaseName(type.alias);
      if (base !== undefined && !typeByName.has(base)) {
        error(type, `Type ${type.name}: unknown alias target "${type.alias}".`);
      }
      continue;
    }
    for (const field of type.fields) {
      const base = typeExprBaseName(field.type);
      if (base !== undefined && !typeByName.has(base)) {
        error(type, `Type ${type.name}: field ${field.name} has unknown type "${field.type}".`);
      }
    }
  }

  // Cycles make a layout infinitely sized; catch them here so the
  // diagnostic points at the .glim line instead of generated AZM.
  const visiting = new Set<string>();
  const safe = new Set<string>();
  const cyclic = new Set<string>();
  const visit = (name: string): boolean => {
    if (safe.has(name)) return true;
    if (visiting.has(name) || cyclic.has(name)) return false;
    const type = typeByName.get(name);
    if (type === undefined) return true;
    visiting.add(name);
    const exprs = type.alias !== undefined ? [type.alias] : type.fields.map((f) => f.type);
    let ok = true;
    for (const expr of exprs) {
      const base = typeExprBaseName(expr);
      if (base !== undefined && !visit(base)) ok = false;
    }
    visiting.delete(name);
    (ok ? safe : cyclic).add(name);
    return ok;
  };
  for (const type of types) {
    if (!visit(type.name)) {
      error(type, `Type ${type.name} is recursive: a layout cannot contain itself.`);
    }
  }
}

/** Symbols the generated runtime and profiles own; user names must avoid them. */
const RESERVED_NAMES = new Set([
  ...Array.from({ length: 4 }, (_, bank) => `Changed${bank}`),
  ...Array.from({ length: 4 }, (_, bank) => `Raised${bank}`),
  ...Array.from({ length: 4 }, (_, bank) => `Next${bank}`),
  'Start',
  'MainLoop',
  'Framebuffer',
  'CurrentCard',
  'Card',
  'PrevKeys',
  'ScanFrame',
  'MxMask',
  'FbPlot',
  'FbClear',
  'ScanDwellPeriod',
  'ApiScanKeys',
  'ApiRandom',
  'ApiStringToLcd',
  'ApiCharToLcd',
  'ApiCommandToLcd',
  'LcdRow1',
  'LcdRow2',
  'LcdRow3',
  'LcdRow4',
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
  'ShapeRotPtrTable',
  'ShapeRotRightTbl',
  'ShapeRotColorTbl',
  'ShapeRotCount',
  'VdpInit',
  'VdpSetAddrWrite',
  'VdpWriteBlock',
  'VdpFill',
  'VdpWaitVBlank',
  'VdpRegInitTbl',
  'SpriteSet',
  'SpriteInit',
  'SpriteShadow',
  'SpriteDirty',
  'NamePut',
  'NameShadow',
  'NameDirtyRows',
  'CommitNameRow',
  'ShapeRowMask',
  'ShapeRowIndex',
  'ShapeColIndex',
  'ShapeDrawRow',
  'ShapeDrawCol',
  'ShapeDrawSkipPixel',
  'ShapeDrawNextRow',
]);
