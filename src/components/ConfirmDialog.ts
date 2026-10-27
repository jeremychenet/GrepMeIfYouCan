// Opens the destructive-copy confirmation (ConfirmDialog.astro) and resolves
// to true only when "Copy anyway" is chosen. Escape or Cancel resolve to false.
export function confirmCopy(text: string): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('[data-confirm]');
  if (!dialog) return Promise.resolve(false);
  dialog.querySelector('[data-confirm-command]')!.textContent = text;
  dialog.returnValue = '';
  const opener = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        opener?.focus();
        resolve(dialog.returnValue === 'copy');
      },
      { once: true },
    );
    dialog.showModal();
  });
}
