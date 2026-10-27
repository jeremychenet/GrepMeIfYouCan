import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'astro/zod';
import { Document, parse as parseYaml, type YAMLSeq } from 'yaml';
import { CATEGORIES, TAGS_MAX, TITLE_MAX } from '../src/content/schema';
import { suggestDanger } from '../src/lib/danger-patterns';
import { describeUnsafe, findUnsafeChars } from '../src/lib/unsafe-chars';

/*
 * One-off import of tldr-pages examples as draft cards (SPEC §4.2).
 * One tldr example becomes one draft in content/drafts/<category>/<id>.yaml,
 * with an empty description and a danger level suggested by the linter.
 * A human writes the description, reviews the card and moves it to
 * content/commands/. Running the import again with the same commit changes nothing.
 */

export const DEFAULTS = {
  selectionPath: 'scripts/tldr-selection.yaml',
  outDir: 'content/drafts',
  publishedRoot: 'content/commands',
  cacheDir: '.cache/tldr',
};

export const ID_LENGTH = 60;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------- selection ----------

const pageSchema = z.strictObject({
  page: z.string().regex(/^(common|linux)\/[a-z0-9._+-]+\.md$/, 'expected "common/<page>.md" or "linux/<page>.md"'),
  tool: z.string().regex(/^[a-z0-9][a-z0-9._+-]*$/, 'must be a lowercase tool name'),
  tags: z.array(z.string().regex(KEBAB, 'tags must be kebab-case')).min(1).max(TAGS_MAX),
  examples: z.array(z.number().int().positive()).min(1).optional(),
});

const selectionSchema = z.strictObject({
  tldr: z.strictObject({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected "<owner>/<repo>"'),
    commit: z.string().regex(/^[0-9a-f]{40}$/, 'expected a full 40-char git SHA'),
  }),
  categories: z.record(z.enum(CATEGORIES), z.array(pageSchema)),
});

export type Selection = z.infer<typeof selectionSchema>;
export type Category = (typeof CATEGORIES)[number];

export function loadSelection(path: string): Selection {
  const result = selectionSchema.safeParse(parseYaml(readFileSync(path, 'utf8')));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`${path} is invalid:\n${issues.join('\n')}`);
  }
  return result.data;
}

// ---------- parsing and conversion ----------

export interface Example {
  /** 1-based position in the page, as used in the selection's `examples`. */
  number: number;
  title: string;
  command: string;
}

/** Reads the examples of a tldr page: a "- title:" line followed by a "`command`" line. */
export function parsePage(markdown: string): Example[] {
  const examples: Example[] = [];
  let title: string | undefined;
  for (const line of markdown.split('\n').map((l) => l.trim())) {
    if (line.startsWith('- ')) {
      title = line.slice(2);
    } else if (title !== undefined && line.length > 1 && line.startsWith('`') && line.endsWith('`')) {
      examples.push({ number: examples.length + 1, title, command: line.slice(1, -1) });
      title = undefined;
    }
  }
  return examples;
}

/** "E[x]tract a `tar` file:" → "Extract a tar file" (mnemonics, backticks and colon removed). */
export function cleanTitle(raw: string): string {
  const title = raw
    .replace(/\[([A-Za-z])\]/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export type Conversion = { ok: true; command: string; notes: string[] } | { ok: false; reason: string };

/**
 * Converts tldr placeholders to the site's template syntax (SPEC §2.5):
 * - `{{path/to/file}}` is kept as is;
 * - `{{[-r|--recursive]}}` / `{{[ps|container ls]}}` become the long form, written literally;
 * - a URL placeholder becomes `{{url:<the URL>}}` (name "url", the URL as default value);
 * - any other ":" inside a placeholder becomes "_", since `{{name:default}}` means a default value.
 * Literal braces cannot be written in our templates, so those examples are skipped.
 */
export function convertCommand(raw: string): Conversion {
  if (/\\[{}]/.test(raw)) return { ok: false, reason: 'escaped braces (\\{\\{) cannot be written in {{…}} templates' };
  if (/\{\{\{|\}\}\}/.test(raw)) return { ok: false, reason: 'ambiguous braces next to a placeholder' };

  const notes: string[] = [];
  const command = raw.replace(/\{\{(.+?)\}\}/g, (_, inner: string) => {
    const alternatives = /^\[(.+)\]$/.exec(inner);
    if (alternatives) return alternatives[1]!.split('|').at(-1)!.trim();
    if (!inner.includes(':')) return `{{${inner}}}`;
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(inner)) return `{{url:${inner}}}`;
    const renamed = `{{${inner.replaceAll(':', '_')}}}`;
    notes.push(`placeholder "{{${inner}}}" renamed "${renamed}" (":" means a default value)`);
    return renamed;
  });

  const leftover = command.replace(/\{\{[^{}]+\}\}/g, '');
  if (leftover.includes('{{') || leftover.includes('}}')) {
    return { ok: false, reason: 'ambiguous braces: unbalanced or empty placeholder' };
  }
  return { ok: true, command, notes };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Kebab-case id "<tool>-<title>", without repeating the tool, cut on a word boundary. */
export function makeId(tool: string, title: string): string {
  const prefix = slugify(tool);
  let id = slugify(title);
  if (id !== prefix && !id.startsWith(`${prefix}-`)) id = `${prefix}-${id}`;
  if (id.length > ID_LENGTH) {
    const cut = id.slice(0, ID_LENGTH + 1);
    const lastDash = cut.lastIndexOf('-');
    // Cut on the last word boundary, unless that would drop most of the id.
    id = lastDash > ID_LENGTH / 2 ? cut.slice(0, lastDash) : cut.slice(0, ID_LENGTH).replace(/-+$/, '');
  }
  return id;
}

// ---------- drafts ----------

export type Card = Record<string, unknown> & { id: string };
export interface Draft {
  category: Category;
  card: Card;
}
export interface BuildResult {
  drafts: Draft[];
  skipped: { page: string; number: number; reason: string }[];
  notes: { id: string; note: string }[];
}
export type PageReader = (page: string) => Promise<string>;

/** Turns the selected examples into draft cards, in selection order (deterministic). */
export async function buildDrafts(selection: Selection, read: PageReader): Promise<BuildResult> {
  const result: BuildResult = { drafts: [], skipped: [], notes: [] };
  const ids = new Set<string>();

  for (const category of CATEGORIES) {
    for (const entry of selection.categories[category]) {
      const examples = parsePage(await read(entry.page));
      const wanted = entry.examples ?? examples.map((e) => e.number);

      for (const number of wanted) {
        const example = examples[number - 1];
        if (!example) throw new Error(`${entry.page}: example ${number} does not exist (the page has ${examples.length})`);
        const skip = (reason: string) => result.skipped.push({ page: entry.page, number, reason });

        const conversion = convertCommand(example.command);
        if (!conversion.ok) {
          skip(conversion.reason);
          continue;
        }
        const title = cleanTitle(example.title);
        const unsafeCommand = findUnsafeChars(conversion.command, { asciiOnly: true });
        if (unsafeCommand.length) {
          skip(`command: unsafe characters: ${describeUnsafe(unsafeCommand)}`);
          continue;
        }
        const unsafeTitle = findUnsafeChars(title);
        if (unsafeTitle.length) {
          skip(`title: unsafe characters: ${describeUnsafe(unsafeTitle)}`);
          continue;
        }

        const base = makeId(entry.tool, title);
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
        ids.add(id);

        const card: Card = {
          id,
          title,
          description: '',
          command: conversion.command,
          tool: entry.tool,
          category,
          tags: entry.tags,
          danger: suggestDanger(conversion.command),
          ...(entry.page.startsWith('linux/') ? { platforms: ['linux'] } : {}),
          source: { type: 'tldr', page: entry.page, commit: selection.tldr.commit, license: 'CC-BY-4.0' },
        };
        result.drafts.push({ category, card });
        for (const note of conversion.notes) result.notes.push({ id, note });
        if (title.length > TITLE_MAX) result.notes.push({ id, note: `title is ${title.length} chars (max ${TITLE_MAX})` });
      }
    }
  }
  return result;
}

const HEADER = [
  ' Draft imported from tldr-pages: write the description, review danger and tags,',
  ' then move this file to content/commands/<category>/.',
].join('\n');

export function renderDraft(card: Card): string {
  const doc = new Document(card);
  (doc.get('tags', true) as YAMLSeq).flow = true;
  doc.commentBefore = HEADER;
  return doc.toString({ lineWidth: 0 });
}

/** Cards already in content/commands: those drafts were reviewed and moved, never recreate them. */
export interface Published {
  ids: Set<string>;
  /** `<source page>\n<command>` of published tldr cards, to recognize a card whose id was renamed. */
  sources: Set<string>;
}
const sourceKey = (page: unknown, command: unknown) => `${page}\n${command}`;

export interface WriteOptions {
  outDir: string;
  published: Published;
  /** Overwrite drafts that differ from the generated content. */
  force: boolean;
}
export interface WriteCounts {
  created: number;
  updated: number;
  unchanged: number;
  kept: number;
  published: number;
}

/** Writes only what changed, so a re-run with the same commit touches no file. */
export function writeDrafts(drafts: Draft[], { outDir, published, force }: WriteOptions): WriteCounts {
  const counts: WriteCounts = { created: 0, updated: 0, unchanged: 0, kept: 0, published: 0 };
  for (const { category, card } of drafts) {
    const source = card.source as { page?: string } | undefined;
    if (published.ids.has(card.id) || published.sources.has(sourceKey(source?.page, card.command))) {
      counts.published++;
      continue;
    }
    const path = join(outDir, category, `${card.id}.yaml`);
    const text = renderDraft(card);
    if (existsSync(path)) {
      const current = readFileSync(path, 'utf8');
      if (current === text) {
        counts.unchanged++;
        continue;
      }
      if (!force) {
        counts.kept++;
        continue;
      }
      counts.updated++;
    } else {
      counts.created++;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return counts;
}

/** Published cards under content/commands/<category>/ (YAML that fails to parse only counts by file name). */
export function readPublished(root: string): Published {
  const published: Published = { ids: new Set(), sources: new Set() };
  if (!existsSync(root)) return published;
  for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.yaml'))) {
    published.ids.add(file.split('/').pop()!.replace(/\.yaml$/, ''));
    let card: { source?: { page?: unknown }; command?: unknown } | null = null;
    try {
      card = parseYaml(readFileSync(join(root, file), 'utf8'));
    } catch {
      continue;
    }
    if (card?.source?.page) published.sources.add(sourceKey(card.source.page, card.command));
  }
  return published;
}

// ---------- download ----------

export interface ReaderOptions {
  repo: string;
  commit: string;
  cacheDir: string;
  fetchFn?: (url: string) => Promise<Response>;
}

/** Reads a page at the pinned commit from raw.githubusercontent.com, cached in cacheDir/<commit>/. */
export function cachedReader({ repo, commit, cacheDir, fetchFn = fetch }: ReaderOptions): PageReader {
  return async (page) => {
    const path = join(cacheDir, commit, page);
    if (existsSync(path)) return readFileSync(path, 'utf8');
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/pages/${page}`;
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const text = await response.text();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return text;
  };
}

// ---------- entry points ----------

export interface MainOptions {
  selectionPath: string;
  outDir: string;
  publishedRoot: string;
  cacheDir: string;
  force: boolean;
  /** Page reader; defaults to the cached download at the pinned commit. */
  read?: PageReader;
  log?: (m: string) => void;
  error?: (m: string) => void;
}

/** Returns the process exit code. */
export async function main(options: MainOptions): Promise<number> {
  const { log = console.log, error = console.error } = options;
  try {
    const selection = loadSelection(options.selectionPath);
    const read = options.read ?? cachedReader({ ...selection.tldr, cacheDir: options.cacheDir });
    const { drafts, skipped, notes } = await buildDrafts(selection, read);
    const counts = writeDrafts(drafts, {
      outDir: options.outDir,
      published: readPublished(options.publishedRoot),
      force: options.force,
    });

    log(`tldr-pages @ ${selection.tldr.commit}`);
    for (const category of CATEGORIES) {
      const n = drafts.filter((d) => d.category === category).length;
      if (n) log(`  ${category}: ${n} draft(s)`);
    }
    if (skipped.length) {
      log(`\nSkipped examples (${skipped.length}):`);
      for (const s of skipped) log(`  ${s.page} #${s.number}: ${s.reason}`);
    }
    if (notes.length) {
      log(`\nTo review (${notes.length}):`);
      const category = new Map(drafts.map((d) => [d.card.id, d.category]));
      for (const n of notes) log(`  ${category.get(n.id)}/${n.id}: ${n.note}`);
    }
    log(
      `\n✓ ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ` +
        `${counts.kept} kept, ${counts.published} already published in ${options.outDir}`,
    );
    if (counts.kept) log(`  (${counts.kept} draft(s) differ from the import and were kept; use --force to overwrite)`);
    return 0;
  } catch (err) {
    error(`✗ import failed: ${(err as Error).message}`);
    return 1;
  }
}

/** Command-line entry: `tsx scripts/import-tldr.ts [--force]`. */
export async function cli(args: string[], overrides: Partial<MainOptions> = {}): Promise<number> {
  const error = overrides.error ?? console.error;
  const unknown = args.filter((a) => a !== '--force');
  if (unknown.length) {
    error(`unknown argument(s): ${unknown.join(' ')}\nusage: import-tldr [--force]`);
    return 2;
  }
  return main({ ...DEFAULTS, force: args.includes('--force'), ...overrides });
}

/* v8 ignore next 3 -- process entry point, its logic is covered through cli() */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await cli(process.argv.slice(2));
}
