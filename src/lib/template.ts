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
