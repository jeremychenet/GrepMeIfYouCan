// Card constants without any dependency, so code that runs in the browser
// (src/lib/pages.ts via ResultsList.ts) does not bundle Zod. schema.ts
// re-exports them.

/** Fixed categories (SPEC §2.2). The folder name under content/commands/ must match. */
export const CATEGORIES = ['linux', 'unix', 'containers', 'cloud-iac', 'git-ci'] as const;
export const DANGER_LEVELS = ['safe', 'caution', 'destructive'] as const;
export const PLATFORMS = ['linux', 'macos', 'unix'] as const;

export const ID_MAX = 80;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 180;
export const TAGS_MAX = 8;
