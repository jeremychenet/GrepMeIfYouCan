// Safe copy (SPEC §2.6, §7.3). The copied text is rebuilt from the card's
// command template and the values typed in its fields, never read from the
// page. It never ends with a newline, and the first copy of a destructive
// card in the session needs a confirmation.
import { parseTemplate, renderTemplate } from './template';
import { classify } from './unsafe-chars';

export type Values = Readonly<Record<string, string>>;

export interface CopyCard {
  id: string;
  command: string;
  danger: 'safe' | 'caution' | 'destructive';
}

/**
 * Cleans a typed value: invisible and bidi characters are removed, newlines,
 * tabs and other control characters become a space (a pasted newline would
 * run the command early). No shell escaping.
 */
export function sanitizeValue(value: string): string {
  let out = '';
  for (const ch of value) {
    const kind = classify(ch.codePointAt(0)!);
    if (kind === 'bidi' || kind === 'invisible') continue;
    out += kind ? ' ' : ch;
  }
  return out;
}

const own = (values: Values, name: string) => (Object.hasOwn(values, name) ? values[name]! : '');

/** Variables without a default whose field is still empty, in order, once each. */
export function missingValues(command: string, values: Values): string[] {
  const names = parseTemplate(command).flatMap((s) =>
    s.type === 'var' && s.default === undefined && !sanitizeValue(own(values, s.name)).trim() ? [s.name] : [],
  );
  return [...new Set(names)];
}

/** The exact text to copy: sanitized and trimmed values, no trailing whitespace or newline. */
export function buildCopyText(command: string, values: Values): string {
  const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, sanitizeValue(v).trim()]));
  return renderTemplate(command, clean).trimEnd();
}

// --- Confirmation of destructive cards, remembered for the browser session ---

export const CONFIRMED_KEY = 'gmiyc:v1:confirmed-destructive';

/** Returns the session storage, or undefined when the browser blocks it. */
export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;

function readConfirmed(storage: StorageGetter): Set<string> | undefined {
  try {
    const raw = storage()?.getItem(CONFIRMED_KEY);
    if (raw === undefined) return undefined;
    const ids: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return undefined;
  }
}

/** True for a destructive card not yet confirmed in this session (or when storage fails). */
export function needsConfirmation(card: Pick<CopyCard, 'id' | 'danger'>, storage: StorageGetter): boolean {
  if (card.danger !== 'destructive') return false;
  return !readConfirmed(storage)?.has(card.id);
}

export function markConfirmed(id: string, storage: StorageGetter): void {
  const ids = readConfirmed(storage);
  if (!ids) return;
  ids.add(id);
  try {
    storage()?.setItem(CONFIRMED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage full or blocked: the next copy simply asks again.
  }
}

// --- The copy itself ---

export type CopyResult =
  | { status: 'copied'; text: string }
  | { status: 'missing'; missing: string[] }
  | { status: 'cancelled' }
  | { status: 'failed' };

export interface CopyDeps {
  writeText: (text: string) => Promise<void>;
  /** Shows the exact text and resolves to true when the user confirms. */
  confirm: (text: string) => Promise<boolean>;
  storage: StorageGetter;
}

export async function copyCard(card: CopyCard, values: Values, deps: CopyDeps): Promise<CopyResult> {
  // A destructive command never gets a target the user did not choose.
  if (card.danger === 'destructive') {
    const missing = missingValues(card.command, values);
    if (missing.length) return { status: 'missing', missing };
  }
  const text = buildCopyText(card.command, values);
  const confirming = needsConfirmation(card, deps.storage);
  if (confirming && !(await deps.confirm(text))) return { status: 'cancelled' };
  try {
    await deps.writeText(text);
  } catch {
    return { status: 'failed' };
  }
  if (confirming) markConfirmed(card.id, deps.storage);
  return { status: 'copied', text };
}
