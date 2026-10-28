// Export / import of favorites and history as a JSON file (SPEC §2.8).
// The import merges into the current lists (src/lib/store.ts).
import { exportFileName, importMessage } from '../lib/backup';
import { IMPORT_MAX_BYTES } from '../lib/store';
import { store } from './LocalStore';

export function setupExportImport(root: HTMLElement): void {
  const exportButton = root.querySelector<HTMLButtonElement>('[data-export]');
  const importButton = root.querySelector<HTMLButtonElement>('[data-import]');
  const file = root.querySelector<HTMLInputElement>('[data-import-file]');
  const message = root.querySelector<HTMLElement>('[data-backup-message]');
  if (!exportButton || !importButton || !file || !message) return;

  exportButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(new Date());
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    message.textContent = 'Export downloaded.';
  });

  importButton.addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    if (chosen.size > IMPORT_MAX_BYTES) {
      message.textContent = importMessage({ ok: false, error: 'This file is too large (1 MB max).' });
      return;
    }
    let text: string;
    try {
      text = await chosen.text();
    } catch {
      message.textContent = importMessage({ ok: false, error: 'This file could not be read.' });
      return;
    }
    message.textContent = importMessage(store.importData(text));
  });
}
