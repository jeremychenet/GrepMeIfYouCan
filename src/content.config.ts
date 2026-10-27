import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { commandSchema } from './content/schema';

// Cards live in content/commands/<category>/<id>.yaml (SPEC §4.1).
// Cross-file rules (unique ids, folder/category) are enforced by
// scripts/validate-content.ts, which runs before every build.
const commands = defineCollection({
  loader: glob({ pattern: '*/*.yaml', base: './content/commands' }),
  schema: commandSchema,
});

export const collections = { commands };
