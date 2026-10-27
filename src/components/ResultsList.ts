// Renders search results by filling copies of the CommandCard <template>
// (see SearchApp.astro). Card data is untrusted text: it only ever goes into
// textContent and attributes, never innerHTML.
import { cardPath, tagSearchPath } from '../lib/pages';
import type { SearchDoc } from '../lib/search';
import { parseTemplate } from '../lib/template';
import { enhanceCard } from './CommandTemplate';

/** Results shown at most; the status line says when there are more. */
export const RESULTS_MAX = 50;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`search: missing ${selector}`);
  return el;
}

export function createResultsList(root: HTMLElement) {
  const list = required<HTMLUListElement>(root, '[data-search-results] ul');
  const cardTemplate = required<HTMLTemplateElement>(root, '[data-result-template]').content;
  const badges = required<HTMLTemplateElement>(root, '[data-badge-template]').content;
  // Prototypes taken from the rendered card, so copies keep its styles.
  const varProto = required<HTMLElement>(cardTemplate, 'var');
  const tagProto = required<HTMLLIElement>(cardTemplate, '.tags li');

  function fillCommand(code: HTMLElement, command: string): void {
    code.replaceChildren(
      ...parseTemplate(command).map((s) => {
        if (s.type === 'text') return document.createTextNode(s.value);
        const v = varProto.cloneNode(true) as HTMLElement;
        v.dataset['var'] = s.name;
        v.title = s.name;
        v.textContent = s.default ?? s.name;
        return v;
      }),
    );
  }

  function fillTags(tags: HTMLElement, names: readonly string[]): void {
    tags.replaceChildren(
      ...names.map((t) => {
        const li = tagProto.cloneNode(true) as HTMLLIElement;
        const a = required<HTMLAnchorElement>(li, 'a');
        a.href = tagSearchPath(t);
        a.dataset['tag'] = t;
        a.textContent = t;
        return li;
      }),
    );
  }

  function renderCard(doc: SearchDoc): Node {
    const item = cardTemplate.cloneNode(true) as DocumentFragment;
    const article = required<HTMLElement>(item, 'article');
    article.dataset['card'] = doc.id;
    article.dataset['danger'] = doc.danger;
    article.dataset['command'] = doc.command;

    const link = required<HTMLAnchorElement>(article, '.title a');
    link.href = cardPath(doc.id);
    link.textContent = doc.title;

    const badge = required<HTMLElement>(article, '[data-danger].badge');
    if (doc.danger === 'safe') badge.remove();
    else badge.replaceWith(required<HTMLElement>(badges, `[data-danger="${doc.danger}"]`).cloneNode(true));

    required<HTMLElement>(article, '.description').textContent = doc.description;
    fillCommand(required<HTMLElement>(article, 'pre code'), doc.command);
    fillTags(required<HTMLElement>(article, '.tags'), doc.tags);
    required<HTMLButtonElement>(article, '[data-copy]').setAttribute('aria-label', `Copy command: ${doc.title}`);
    enhanceCard(article);
    return item;
  }

  return {
    render(docs: readonly SearchDoc[]): void {
      list.replaceChildren(...docs.slice(0, RESULTS_MAX).map(renderCard));
    },
  };
}
