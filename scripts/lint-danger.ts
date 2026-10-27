import { pathToFileURL } from 'node:url';
import { checkSafety, formatErrors } from '../src/content/validate';
import { readEntries } from './validate-content';

/**
 * Danger + unsafe-character lint only, without the full schema. Used on
 * drafts (content/drafts/), which have no description yet. Published cards
 * get the same checks through lint-content.
 * Returns the process exit code.
 */
export function main(roots: string[], log = console.log, error = console.error): number {
  let count = 0;
  const problems: string[] = [];
  for (const root of roots) {
    const { entries, parseErrors } = readEntries(root);
    count += entries.length;
    problems.push(...parseErrors);
    const errors = entries.flatMap((e) => checkSafety(e.file, e.data));
    if (errors.length) problems.push(formatErrors(errors.map((e) => ({ ...e, file: `${root}/${e.file}` }))));
  }
  if (problems.length) {
    error(problems.join('\n'));
    error(`\n✗ danger lint failed in ${roots.join(', ')}`);
    return 1;
  }
  log(`✓ ${count} card(s) pass the danger lint in ${roots.join(', ')}`);
  return 0;
}

/** Command-line entry: `tsx scripts/lint-danger.ts [root...]` (default: content/commands). */
export function cli(args: string[]): number {
  return main(args.length ? args : ['content/commands']);
}

/* v8 ignore next 3 -- process entry point, its logic is covered through cli() */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = cli(process.argv.slice(2));
}
