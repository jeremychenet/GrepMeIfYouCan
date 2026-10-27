import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseTemplate, variableNames } from '../../src/lib/template';

describe('parseTemplate', () => {
  it('returns a single text segment when there is no placeholder', () => {
    expect(parseTemplate('ls -la')).toEqual([{ type: 'text', value: 'ls -la' }]);
  });

  it('splits text and variables in order', () => {
    expect(parseTemplate('chmod +x {{file}}')).toEqual([
      { type: 'text', value: 'chmod +x ' },
      { type: 'var', name: 'file', raw: '{{file}}' },
    ]);
  });

  it('reads a default value after the first colon only', () => {
    expect(parseTemplate('curl {{url:https://example.com:8080/a}}')).toEqual([
      { type: 'text', value: 'curl ' },
      {
        type: 'var',
        name: 'url',
        default: 'https://example.com:8080/a',
        raw: '{{url:https://example.com:8080/a}}',
      },
    ]);
  });

  it('keeps an empty default distinct from no default', () => {
    expect(parseTemplate('{{x:}}')).toEqual([{ type: 'var', name: 'x', default: '', raw: '{{x:}}' }]);
  });

  it('accepts tldr-style names with slashes, dots and dashes', () => {
    const names = variableNames('cp {{path/to/file.txt}} {{target-dir}} {{a_b}}');
    expect(names).toEqual(['path/to/file.txt', 'target-dir', 'a_b']);
  });

  it('handles adjacent variables and variables at both ends', () => {
    const segments = parseTemplate('{{a}}{{b}}-{{c:1}}');
    expect(segments.map((s) => s.type)).toEqual(['var', 'var', 'text', 'var']);
  });

  it('leaves non-placeholder braces as text', () => {
    for (const cmd of [
      'find . -exec ls {} +',
      'echo ${HOME}',
      "docker inspect --format '{{.State.Status}}' c",
      '{{ spaced }}',
      '{{}}',
      '{{unclosed',
    ]) {
      expect(parseTemplate(cmd)).toEqual([{ type: 'text', value: cmd }]);
    }
  });

  it('does not let a default run past the closing braces', () => {
    expect(variableNames('{{a:1}} and {{b:2}}')).toEqual(['a', 'b']);
  });

  it('lists each variable name once, in order of first use', () => {
    expect(variableNames('{{x}} {{y}} {{x:1}}')).toEqual(['x', 'y']);
  });

  it('rebuilds the exact command from its segments', () => {
    const cmd = 'tar -czf {{archive:out.tar.gz}} {{path/to/dir}} && echo {} ${X}';
    const rebuilt = parseTemplate(cmd)
      .map((s) => (s.type === 'text' ? s.value : s.raw))
      .join('');
    expect(rebuilt).toBe(cmd);
  });

  it('parses every published card without leaving stray {{ or }}', () => {
    const root = 'content/commands';
    for (const dir of readdirSync(root)) {
      for (const file of readdirSync(join(root, dir))) {
        const { command } = parse(readFileSync(join(root, dir, file), 'utf8')) as {
          command: string;
        };
        const text = parseTemplate(command)
          .filter((s) => s.type === 'text')
          .map((s) => s.value)
          .join('');
        expect(text, file).not.toMatch(/\{\{|\}\}/);
      }
    }
  });
});
