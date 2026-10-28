// Editable variables and the Copy button of a command card (SPEC §2.5, §2.6).
// Each <var> of the card's command becomes an inline field. Copying rebuilds
// the text from the card's command template (data-command) and the field
// values, through src/lib/copy.ts: never from the displayed text.
import { copyCard, sanitizeValue, type CopyCard } from '../lib/copy';
import { parseTemplate } from '../lib/template';
import { confirmCopy } from './ConfirmDialog';
import { enhanceFavorite } from './FavoriteButton';
import { store } from './LocalStore';
import { showToast } from './Toast';

/** Visually hidden note in Base.astro, referenced by every field. */
const HINT_ID = 'var-hint';
const HINT = 'Inserted as typed, without shell escaping';
const MIN_WIDTH_CH = 2;

const isDanger = (v: string | undefined): v is CopyCard['danger'] =>
  v === 'safe' || v === 'caution' || v === 'destructive';

const sessionStore = () => window.sessionStorage;

function resize(input: HTMLInputElement): void {
  const chars = Math.max(input.value.length, input.placeholder.length, MIN_WIDTH_CH);
  input.style.width = `${chars + 1}ch`;
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
