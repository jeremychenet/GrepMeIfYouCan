import { describe, expect, it } from 'vitest';
import { exportFileName, importMessage } from '../../src/lib/backup';

describe('exportFileName', () => {
  it('uses the local date, zero-padded', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('grepmeifyoucan-2026-01-05.json');
    expect(exportFileName(new Date(2026, 9, 28))).toBe('grepmeifyoucan-2026-10-28.json');
  });
});

describe('importMessage', () => {
  it('reports what was added', () => {
    expect(importMessage({ ok: true, favorites: 2, history: 1, skipped: 0 })).toBe(
      'Imported 2 new favorites and 1 new history entry.',
    );
    expect(importMessage({ ok: true, favorites: 1, history: 0, skipped: 0 })).toBe(
      'Imported 1 new favorite and 0 new history entries.',
    );
  });

  it('says when entries were dropped over the limits', () => {
    expect(importMessage({ ok: true, favorites: 3, history: 0, skipped: 1 })).toMatch(/1 older entry was dropped/);
    expect(importMessage({ ok: true, favorites: 3, history: 0, skipped: 4 })).toMatch(/4 older entries were dropped/);
  });

  it('shows the error of a refused file', () => {
    expect(importMessage({ ok: false, error: 'This file is not valid JSON.' })).toBe(
      'Import failed: This file is not valid JSON.',
    );
  });
});
