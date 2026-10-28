// Editable variables and the Copy button of a command card (SPEC §2.5, §2.6).
// Each <var> of the card's command becomes an inline field. Copying rebuilds
// the text from the card's command template (data-command) and the field
// values, through src/lib/copy.ts: never from the displayed text.
// A value typed in one card fills the variable of the same name in the other
// cards of the page (src/lib/shared-values.ts), except destructive ones.
import { copyCard, sanitizeValue, type CopyCard } from '../lib/copy';
import { createSharedValues, receivesSharedValues } from '../lib/shared-values';
import { parseTemplate } from '../lib/template';
import { confirmCopy } from './ConfirmDialog';
import { enhanceFavorite } from './FavoriteButton';
import { store } from './LocalStore';
import { showToast } from './Toast';

/** Visually hidden note in Base.astro, referenced by every field. */
const HINT_ID = 'var-hint';
const HINT = 'Inserted as typed, without shell escaping';
const MIN_WIDTH_CH = 1;
/** How long the Copy button shows "Copied". */
const DONE_MS = 1500;

/** Values typed on this page, shared by every card. */
const shared = createSharedValues();

const isDanger = (v: string | undefined): v is CopyCard['danger'] =>
  v === 'safe' || v === 'caution' || v === 'destructive';

const sessionStore = () => window.sessionStorage;

// Where supported, CSS sizes the field to its text (`field-sizing: content`,
// global.css), exactly like the <var> it replaces: no layout shift.
const autoSized = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

function resize(input: HTMLInputElement): void {
  if (autoSized) return;
  // Monospace: one `ch` per character (padding comes from CSS).
  const chars = Math.max(input.value.length, input.placeholder.length, MIN_WIDTH_CH);
  input.style.width = `${chars}ch`;
}

/** Fills the same variable in the other cards of the page that accept it. */
function carryOver(from: HTMLElement, name: string, value: string): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('article[data-card] .var-input')) {
    const article = input.closest<HTMLElement>('article[data-card]')!;
    const danger = article.dataset['danger'];
    if (article === from || input.dataset['var'] !== name || !isDanger(danger) || !receivesSharedValues(danger)) continue;
    input.value = value;
    input.removeAttribute('aria-invalid');
    resize(input);
  }
}

/** "Copied" on the button for a moment (the toast announces it too). */
const doneTimers = new WeakMap<HTMLButtonElement, number>();

function showDone(button: HTMLButtonElement): void {
  window.clearTimeout(doneTimers.get(button));
  button.dataset['state'] = 'done';
  button.textContent = 'Copied';
  doneTimers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset['state'];
      button.textContent = 'Copy';
    }, DONE_MS),
  );
}

export function enhanceCard(article: HTMLElement): void {
  const { card: id, command, danger } = article.dataset;
  if (article.dataset['enhanced'] || !id || !command || !isDanger(danger)) return;
  article.dataset['enhanced'] = 'true';
  enhanceFavorite(article);
  const card: CopyCard = { id, command, danger };

  const defaults = new Map<string, string | undefined>();
  for (const s of parseTemplate(command)) if (s.type === 'var' && !defaults.has(s.name)) defaults.set(s.name, s.default);

  const fields = new Map<string, HTMLInputElement[]>();
  for (const v of article.querySelectorAll<HTMLElement>('pre var[data-var]')) {
    const name = v.dataset['var']!;
    if (!defaults.has(name)) continue;
    const def = defaults.get(name);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'var-input';
    input.dataset['var'] = name;
    input.placeholder = def ?? name;
    input.title = HINT;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('aria-label', `Value for ${name}`);
    input.setAttribute('aria-describedby', HINT_ID);
    if (danger === 'destructive' && def === undefined) input.setAttribute('aria-required', 'true');
    input.value = shared.valueFor(name, danger) ?? '';
    resize(input);
    v.replaceWith(input);
    fields.set(name, [...(fields.get(name) ?? []), input]);
  }

  article.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const name = input.dataset['var'];
    if (!name || !fields.has(name)) return;
    // What the field shows is what gets copied: drop invisible characters now.
    const clean = sanitizeValue(input.value);
    if (clean !== input.value) input.value = clean;
    for (const other of fields.get(name)!) {
      if (other !== input) other.value = clean;
      other.removeAttribute('aria-invalid');
      resize(other);
    }
    shared.set(name, clean);
    carryOver(article, name, clean);
  });

  const button = article.querySelector<HTMLButtonElement>('[data-copy]');
  if (!button) return;
  button.hidden = false;
  // A flag rather than `disabled`: the confirmation dialog gives focus back
  // to this button when it closes, which a disabled button cannot take.
  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const values = Object.fromEntries([...fields].map(([name, inputs]) => [name, inputs[0]!.value]));
    const result = await copyCard(card, values, {
      writeText: async (text) => navigator.clipboard.writeText(text),
      confirm: confirmCopy,
      storage: sessionStore,
    });
    busy = false;
    if (result.status === 'copied') {
      // Only copies go to the history, never searches (SPEC §2.8).
      store.addHistory(id);
      showToast('Copied');
      showDone(button);
    }
    else if (result.status === 'failed') showToast('Copy failed: select the command and copy it by hand');
    else if (result.status === 'missing') {
      for (const name of result.missing) for (const i of fields.get(name) ?? []) i.setAttribute('aria-invalid', 'true');
      fields.get(result.missing[0]!)?.[0]?.focus();
      showToast(`Fill in ${result.missing.join(', ')} first`);
    }
  });
}

for (const article of document.querySelectorAll<HTMLElement>('article[data-card][data-command]')) {
  enhanceCard(article);
}
