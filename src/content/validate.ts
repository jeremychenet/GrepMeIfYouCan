import { LEVELS, underDeclared, type DangerLevel } from '../lib/danger-patterns';
import { describeUnsafe, findUnsafeChars } from '../lib/unsafe-chars';
import { commandSchema, type Command } from './schema';

/** A card as read from disk, before validation. */
export interface RawEntry {
  /** Path relative to the content root, e.g. "linux/find-large-files.yaml". */
  file: string;
  data: unknown;
}

export interface ValidationError {
  file: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  commands: Command[];
  errors: ValidationError[];
}

const isLevel = (v: unknown): v is DangerLevel => LEVELS.includes(v as DangerLevel);

/**
 * Safety checks shared by lint-content and lint-danger (drafts too). Runs on
 * the raw YAML values: the schema trims strings, which would hide trailing
 * invisible characters and newlines.
 */
export function checkSafety(file: string, data: unknown): ValidationError[] {
  if (typeof data !== 'object' || data === null) return [];
  const card = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  for (const field of ['command', 'title', 'description'] as const) {
    const value = card[field];
    if (typeof value !== 'string') continue;
    const unsafe = findUnsafeChars(value, { asciiOnly: field === 'command' });
    if (unsafe.length) {
      errors.push({ file, field, message: `unsafe characters: ${describeUnsafe(unsafe)}` });
    }
  }

  if (typeof card.command === 'string' && isLevel(card.danger)) {
    for (const rule of underDeclared(card.command, card.danger)) {
      errors.push({
        file,
        field: 'danger',
        message: `declared "${card.danger}" but matches "${rule.label}" [${rule.id}], requires "${rule.level}"`,
      });
    }
  }
  return errors;
}

const baseName = (file: string) => file.split('/').pop()!.replace(/\.ya?ml$/, '');
const folder = (file: string) => {
  const parts = file.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
};

/**
 * Validates every card: safety checks (danger level, unsafe characters), the
 * schema, then the rules spanning files:
 * id == file name, category == folder, ids unique across the whole site.
 */
export function validateEntries(entries: RawEntry[]): ValidationResult {
  const errors: ValidationError[] = [];
  const commands: Command[] = [];
  const seen = new Map<string, string>();

  for (const { file, data } of entries) {
    errors.push(...checkSafety(file, data));
    const parsed = commandSchema.safeParse(data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ file, field: issue.path.join('.') || '(root)', message: issue.message });
      }
      continue;
    }
    const cmd = parsed.data;

    if (cmd.id !== baseName(file)) {
      errors.push({ file, field: 'id', message: `must match the file name "${baseName(file)}"` });
    }
    if (cmd.category !== folder(file)) {
      errors.push({ file, field: 'category', message: `must match the folder "${folder(file)}"` });
    }
    const first = seen.get(cmd.id);
    if (first) {
      errors.push({ file, field: 'id', message: `duplicate id, already used by ${first}` });
    } else {
      seen.set(cmd.id, file);
    }
    commands.push(cmd);
  }

  return { commands, errors };
}

export function formatErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.file}: ${e.field} → ${e.message}`).join('\n');
}
