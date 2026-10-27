// Theme toggle button (SPEC §3.1). Logic lives in src/lib/theme.ts (tested);
// this file only wires it to the DOM.
import { currentTheme, otherTheme, saveTheme, toggleLabel } from '../lib/theme';

const root = document.documentElement;
const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');

function sync(): void {
  const label = toggleLabel(currentTheme(root));
  for (const button of buttons) button.setAttribute('aria-label', label);
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    const next = otherTheme(currentTheme(root));
    root.dataset['theme'] = next;
    saveTheme(next);
    sync();
  });
}

sync();
