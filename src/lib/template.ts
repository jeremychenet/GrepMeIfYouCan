// Command templates (SPEC §2.5): `{{name}}` or `{{name:default}}`, tldr-compatible.
// The name stops at the first ":"; the default may contain ":" but not "}}".
// Anything else (`{}`, `${VAR}`, Go templates like `{{.State}}`) stays plain text.

export interface TextSegment {
  type: 'text';
  value: string;
}

export interface VarSegment {
  type: 'var';
  name: string;
  /** Absent when the placeholder has no ":"; may be the empty string. */
  default?: string;
  /** The placeholder exactly as written in the command. */
  raw: string;
}

export type Segment = TextSegment | VarSegment;

const PLACEHOLDER = /\{\{([A-Za-z0-9_][A-Za-z0-9_./-]*)(?::((?:(?!\}\}).)*?))?\}\}/g;

export function parseTemplate(command: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of command.matchAll(PLACEHOLDER)) {
    const [raw, name, def] = match;
    if (match.index > last) segments.push({ type: 'text', value: command.slice(last, match.index) });
    segments.push(
      def === undefined ? { type: 'var', name: name!, raw } : { type: 'var', name: name!, default: def, raw },
    );
    last = match.index + raw.length;
  }
  if (last < command.length) segments.push({ type: 'text', value: command.slice(last) });
  return segments;
}

/** Variable names in order of first use, without duplicates. */
export function variableNames(command: string): string[] {
  const names = parseTemplate(command).flatMap((s) => (s.type === 'var' ? [s.name] : []));
  return [...new Set(names)];
}

/**
 * The command with each variable replaced by its value, or by its default
 * when the value is empty, or by its name when there is no default.
 * Values are inserted as plain text: no shell escaping (SPEC §2.5).
 */
export function renderTemplate(command: string, values: Readonly<Record<string, string>>): string {
  // Own keys only: a variable named "constructor" must not read Object.prototype.
  const value = (name: string) => (Object.hasOwn(values, name) ? values[name] : '');
  return parseTemplate(command)
    .map((s) => (s.type === 'text' ? s.value : value(s.name) || (s.default ?? s.name)))
    .join('');
}
