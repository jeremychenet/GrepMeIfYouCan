// Values carried over between cards (SPEC §2.5): a value typed for a variable
// (e.g. `path`) fills the variable of the same name on the other cards of the
// page. Kept in memory only, never stored. Destructive cards never receive a
// carried value: what they will copy must be typed in them.
import { sanitizeValue, type CopyCard } from './copy';

export function receivesSharedValues(danger: CopyCard['danger']): boolean {
  return danger !== 'destructive';
}

export function createSharedValues() {
  // A Map, so names like `__proto__` or `constructor` are plain keys.
  const values = new Map<string, string>();
  return {
    /** Records a typed value; returns it sanitized. An empty value forgets the variable. */
    set(name: string, raw: string): string {
      const clean = sanitizeValue(raw);
      if (clean === '') values.delete(name);
      else values.set(name, clean);
      return clean;
    },
    /** The carried value for a variable of a card with this danger level, if any. */
    valueFor(name: string, danger: CopyCard['danger']): string | undefined {
      return receivesSharedValues(danger) ? values.get(name) : undefined;
    },
  };
}

export type SharedValues = ReturnType<typeof createSharedValues>;
