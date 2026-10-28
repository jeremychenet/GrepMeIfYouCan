// Opens the keyboard shortcuts help (ShortcutsHelp.astro). On keyboard
// devices, also reveals the footer buttons that open it (hidden by default:
// without JS or on a touch screen there is nothing to show).
import { isTouchOnly } from '../lib/keyboard';

export function openShortcutsHelp(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-shortcuts]');
  if (dialog && !dialog.open) dialog.showModal();
}

if (!isTouchOnly((q) => window.matchMedia(q).matches)) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-shortcuts-open]')) {
    button.hidden = false;
    button.addEventListener('click', openShortcutsHelp);
  }
}
