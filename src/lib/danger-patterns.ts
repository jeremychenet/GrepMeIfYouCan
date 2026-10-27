/**
 * Danger lint (SPEC §7.2): detects risky commands so that a card can never be
 * published with a danger level lower than what the command actually does.
 * False positives are acceptable (raise the level); misses are not.
 */

export const LEVELS = ['safe', 'caution', 'destructive'] as const;
export type DangerLevel = (typeof LEVELS)[number];

const rank = (level: DangerLevel) => LEVELS.indexOf(level);

export interface DangerRule {
  id: string;
  label: string;
  level: Exclude<DangerLevel, 'safe'>;
  test: (cmd: Parsed) => boolean;
}

export interface Parsed {
  /** Whitespace-normalized command. */
  raw: string;
  /** Simple commands split on pipes, lists and substitutions, as token arrays. */
  segments: string[][];
}

/** Splits a one-line shell command into simple commands made of tokens (quotes stripped). */
export function parse(command: string): Parsed {
  const raw = command.replace(/\s+/g, ' ').trim();
  const segments = raw
    .replace(/\$\(|<\(|[`()]/g, ' ; ')
    .split(/\|\||&&|[|;&]/)
    .map((s) => s.trim().split(' ').map((t) => t.replace(/^["']+|["']+$/g, '')).filter(Boolean))
    .filter((s) => s.length > 0);
  return { raw, segments };
}

/** Arguments following the first occurrence of `program` (also matches /bin/<program>). */
function argsOf(seg: string[], program: string): string[] | undefined {
  const i = seg.findIndex((t) => t === program || t.endsWith(`/${program}`));
  return i === -1 ? undefined : seg.slice(i + 1);
}

/** True when some segment runs `program` with arguments satisfying `pred`. */
const runs = (program: string, pred: (args: string[]) => boolean = () => true) => (p: Parsed) =>
  p.segments.some((seg) => {
    const args = argsOf(seg, program);
    return args !== undefined && pred(args);
  });

/** Short option groups like `-rf` contain `letter`. */
const shortFlag = (args: string[], letters: string) =>
  args.some((a) => /^-[a-zA-Z]+$/.test(a) && [...letters].some((l) => a.includes(l)));

const has = (args: string[], ...tokens: string[]) => tokens.some((t) => args.includes(t));

const SHELL = '(?:sudo\\s+)?(?:sh|bash|zsh|dash|ksh)\\b';

export const RULES: DangerRule[] = [
  // ---- destructive ----
  {
    id: 'rm-recursive',
    label: 'recursive delete (rm -r)',
    level: 'destructive',
    test: runs('rm', (a) => shortFlag(a, 'rR') || has(a, '--recursive')),
  },
  { id: 'find-delete', label: 'find -delete', level: 'destructive', test: runs('find', (a) => has(a, '-delete')) },
  { id: 'dd-write', label: 'raw write with dd of=', level: 'destructive', test: runs('dd', (a) => a.some((t) => t.startsWith('of='))) },
  { id: 'mkfs', label: 'filesystem creation (mkfs)', level: 'destructive', test: (p) => p.segments.some((s) => s.some((t) => /^mkfs(\.\w+)?$/.test(t))) },
  { id: 'wipefs', label: 'wipefs', level: 'destructive', test: runs('wipefs') },
  { id: 'shred', label: 'shred', level: 'destructive', test: runs('shred') },
  {
    id: 'raw-disk-write',
    label: 'redirect to a block device',
    level: 'destructive',
    test: (p) => />\s*\/dev\/(?:sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|mmcblk\d|disk\d)/.test(p.raw),
  },
  {
    id: 'fork-bomb',
    label: 'fork bomb',
    level: 'destructive',
    test: (p) => /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(p.raw),
  },
  {
    id: 'pipe-to-shell',
    label: 'downloaded script piped to a shell (curl | sh)',
    level: 'destructive',
    test: (p) =>
      new RegExp(`\\b(?:curl|wget)\\b[^|]*\\|\\s*${SHELL}`).test(p.raw) ||
      /\b(?:sh|bash|zsh)\s+(?:-c\s+)?["']?(?:\$\(|<\()\s*(?:curl|wget)\b/.test(p.raw),
  },
  {
    id: 'base64-to-shell',
    label: 'decoded payload piped to a shell (base64 -d | sh)',
    level: 'destructive',
    test: (p) => new RegExp(`\\bbase64\\s+(?:-d|-D|--decode)\\b[^|]*\\|\\s*${SHELL}`).test(p.raw),
  },
  { id: 'terraform-destroy', label: 'terraform destroy', level: 'destructive', test: runs('terraform', (a) => has(a, 'destroy', '-destroy')) },
  { id: 'kubectl-delete', label: 'kubectl delete', level: 'destructive', test: runs('kubectl', (a) => has(a, 'delete')) },
  { id: 'helm-uninstall', label: 'helm uninstall', level: 'destructive', test: runs('helm', (a) => has(a, 'uninstall', 'delete', 'del', 'un')) },
  {
    id: 'git-push-force',
    label: 'git push --force',
    level: 'destructive',
    test: runs('git', (a) => has(a, 'push') && (has(a, '--force') || shortFlag(a, 'f') || a.some((t) => /^\+\S/.test(t)))),
  },
  { id: 'git-reset-hard', label: 'git reset --hard', level: 'destructive', test: runs('git', (a) => has(a, 'reset') && has(a, '--hard')) },
  {
    id: 'git-clean-force',
    label: 'git clean -f',
    level: 'destructive',
    test: runs('git', (a) => has(a, 'clean') && (has(a, '--force') || shortFlag(a, 'f'))),
  },
  { id: 'docker-prune', label: 'docker prune', level: 'destructive', test: runs('docker', (a) => has(a, 'prune')) },
  {
    id: 'aws-s3-rm-recursive',
    label: 'aws s3 rm --recursive',
    level: 'destructive',
    test: runs('aws', (a) => has(a, 's3') && has(a, 'rm', 'rb') && has(a, '--recursive', '--force')),
  },
  // ---- caution ----
  { id: 'rm', label: 'file deletion (rm)', level: 'caution', test: runs('rm') },
  { id: 'chmod-777', label: 'world-writable permissions (chmod 777)', level: 'caution', test: runs('chmod', (a) => a.some((t) => /^0?777$/.test(t))) },
  {
    id: 'kill-force',
    label: 'forced process kill',
    level: 'caution',
    test: (p) => runs('kill', (a) => has(a, '-9', '-KILL', '-SIGKILL', '-s'))(p) || runs('pkill')(p) || runs('killall')(p),
  },
  {
    id: 'force-flag',
    label: '--force flag',
    level: 'caution',
    test: (p) => p.segments.some((s) => s.some((t) => t === '--force' || t.startsWith('--force-') || t.startsWith('--force='))),
  },
];

/** Every rule the command triggers. */
export function detectDanger(command: string): DangerRule[] {
  const parsed = parse(command);
  return RULES.filter((r) => r.test(parsed));
}

/** Minimum danger level the command requires (used to prefill imported cards). */
export function suggestDanger(command: string): DangerLevel {
  return detectDanger(command).reduce<DangerLevel>((max, r) => (rank(r.level) > rank(max) ? r.level : max), 'safe');
}

/** Rules whose level is above the declared one; empty when the label is acceptable. */
export function underDeclared(command: string, declared: DangerLevel): DangerRule[] {
  return detectDanger(command).filter((r) => rank(r.level) > rank(declared));
}
