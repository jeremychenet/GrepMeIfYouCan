import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { formatErrors, validateEntries, type RawEntry } from '../src/content/validate';

export const DEFAULT_ROOT = 'content/commands';

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listYamlFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

/** Reads every card under `root`; YAML syntax errors are reported like schema errors. */
export function readEntries(root: string): { entries: RawEntry[]; parseErrors: string[] } {
  const entries: RawEntry[] = [];
  const parseErrors: string[] = [];
  for (const path of listYamlFiles(root).sort()) {
    const file = relative(root, path);
    try {
      entries.push({ file, data: parse(readFileSync(path, 'utf8')) });
    } catch (err) {
      parseErrors.push(`${file}: invalid YAML → ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return { entries, parseErrors };
}

/** Returns the process exit code: 0 when every card is valid. */
export function main(root = DEFAULT_ROOT, log = console.log, error = console.error): number {
  const { entries, parseErrors } = readEntries(root);
  const { commands, errors } = validateEntries(entries);
  const messages = [...parseErrors, ...(errors.length ? [formatErrors(errors)] : [])];

  if (messages.length) {
    error(messages.join('\n'));
    error(`\n✗ ${parseErrors.length + errors.length} error(s) in ${root}`);
    return 1;
  }
  log(`✓ ${commands.length} command card(s) valid in ${root}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv[2]);
}
