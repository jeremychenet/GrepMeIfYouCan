// Texts and file name of the favorites/history backup (SPEC §2.8),
// used by src/components/ExportImport.ts.
import type { ImportResult } from './store';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** grepmeifyoucan-2026-10-28.json, from the local date. */
export function exportFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `grepmeifyoucan-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function importMessage(result: ImportResult): string {
  if (!result.ok) return `Import failed: ${result.error}`;
  const added = `Imported ${plural(result.favorites, 'new favorite', 'new favorites')} and ${plural(result.history, 'new history entry', 'new history entries')}.`;
  if (result.skipped === 0) return added;
  return `${added} ${plural(result.skipped, 'older entry was', 'older entries were')} dropped to stay within the limits.`;
}
