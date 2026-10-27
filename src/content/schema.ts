import { z } from 'astro/zod';

/** Fixed categories (SPEC §2.2). The folder name under content/commands/ must match. */
export const CATEGORIES = ['linux', 'containers', 'cloud-iac', 'git-ci'] as const;
export const DANGER_LEVELS = ['safe', 'caution', 'destructive'] as const;
export const PLATFORMS = ['linux', 'macos'] as const;

export const ID_MAX = 80;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 180;
export const TAGS_MAX = 8;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL = /^[a-z0-9][a-z0-9._+-]*$/;
const SHA1 = /^[0-9a-f]{40}$/;

/**
 * A sentence break is a terminator followed by whitespace and an uppercase
 * letter: "Lists files. Shows sizes." is two sentences, while abbreviations
 * ("e.g. disk") and versions ("v1.2") are not.
 */
export function countSentences(text: string): number {
  return text.split(/[.!?]\s+(?=[A-Z])/).length;
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, '');

const tldrSource = z.strictObject({
  type: z.literal('tldr'),
  page: z.string().regex(/^[a-z0-9_-]+\/[^\s/]+\.md$/, 'expected "<platform>/<page>.md"'),
  commit: z.string().regex(SHA1, 'expected a full 40-char git SHA'),
  license: z.literal('CC-BY-4.0'),
});

const originalSource = z.strictObject({
  type: z.literal('original'),
});

export const commandSchema = z
  .strictObject({
    id: z.string().max(ID_MAX).regex(KEBAB, 'must be kebab-case'),
    title: z.string().trim().min(1, 'is required').max(TITLE_MAX),
    description: z
      .string()
      .trim()
      .min(1, 'is required')
      .max(DESCRIPTION_MAX, `must be at most ${DESCRIPTION_MAX} characters`)
      .refine((d) => countSentences(d) === 1, 'must be a single sentence'),
    command: z.string().trim().min(1, 'is required'),
    tool: z.string().regex(TOOL, 'must be a lowercase tool name'),
    category: z.enum(CATEGORIES),
    tags: z
      .array(z.string().regex(KEBAB, 'tags must be lowercase kebab-case'))
      .min(1, 'needs at least one tag')
      .max(TAGS_MAX)
      .refine((t) => new Set(t).size === t.length, 'tags must be unique'),
    danger: z.enum(DANGER_LEVELS),
    platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
    source: z.discriminatedUnion('type', [tldrSource, originalSource]),
  })
  .refine((c) => normalize(c.description) !== normalize(c.title), {
    message: 'must explain what the command does, not repeat the title',
    path: ['description'],
  });

export type Command = z.infer<typeof commandSchema>;
