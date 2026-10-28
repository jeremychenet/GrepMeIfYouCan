// Helpers shared by the static pages and scripts/check-dist.ts:
// public paths, grouping, and page titles/descriptions.
import type { Command } from '../content/schema';
import { CATEGORIES } from '../content/schema';

type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  linux: 'Linux',
  containers: 'Containers',
  'cloud-iac': 'Cloud & IaC',
  'git-ci': 'Git & CI',
};

export const cardPath = (id: string) => `/c/${id}`;
export const toolPath = (tool: string) => `/tools/${tool}`;
export const categoryPath = (category: string) => `/categories/${category}`;
/** Home page search filtered by one tag. */
export const tagSearchPath = (tag: string) => `/?tag=${encodeURIComponent(tag)}`;

const byTitle = (a: Command, b: Command) =>
  a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

export function sortByTitle(cards: readonly Command[]): Command[] {
  return [...cards].sort(byTitle);
}

/** Groups cards by key; keys are sorted, cards inside a group are sorted by title. */
export function groupBy(cards: readonly Command[], key: (c: Command) => string): Map<string, Command[]> {
  const groups = new Map<string, Command[]>();
  for (const c of cards) groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
  return new Map(
    [...groups.keys()].sort().map((k) => [k, sortByTitle(groups.get(k)!)] as const),
  );
}

const DESCRIPTION_MAX = 160;
const ELLIPSIS = String.fromCodePoint(0x2026);

/** "N ready-to-copy <label> commands: title, title, …" capped at 160 characters. */
function listDescription(label: string, cards: readonly Command[]): string {
  const noun = cards.length === 1 ? 'command' : 'commands';
  const head = `${cards.length} ready-to-copy ${label} ${noun}: `;
  const titles = sortByTitle(cards).map((c) => c.title);
  let text = head + titles.join(', ') + '.';
  if (text.length <= DESCRIPTION_MAX) return text;
  text = head;
  for (const t of titles) {
    const next = text === head ? text + t : `${text}, ${t}`;
    if (next.length + 2 > DESCRIPTION_MAX) break;
    text = next;
  }
  return `${text}, ${ELLIPSIS}`;
}

export interface PageMeta {
  title: string;
  description: string;
}

export function toolPageMeta(tool: string, cards: readonly Command[]): PageMeta {
  return { title: `${tool} commands`, description: listDescription(tool, cards) };
}

export function categoryPageMeta(category: Category, cards: readonly Command[]): PageMeta {
  const label = CATEGORY_LABELS[category];
  return { title: `${label} commands`, description: listDescription(label, cards) };
}

/** Link to the tldr page at the pinned commit, or null for original content. */
export function sourceUrl(card: Command): string | null {
  if (card.source.type !== 'tldr') return null;
  return `https://github.com/tldr-pages/tldr/blob/${card.source.commit}/pages/${card.source.page}`;
}

/** Pages that do not depend on the content (favorites and history are filled in the browser). */
export const STATIC_PAGES = ['/about', '/favorites', '/history', '/privacy'] as const;

/** Every page the build must produce, sorted (home, static pages, cards, categories, tools). */
export function expectedPages(cards: readonly Command[]): string[] {
  const paths = new Set<string>(STATIC_PAGES);
  for (const c of cards) {
    paths.add(cardPath(c.id));
    paths.add(toolPath(c.tool));
    paths.add(categoryPath(c.category));
  }
  return ['/', ...[...paths].sort()];
}
