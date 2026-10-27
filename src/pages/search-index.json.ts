// /search-index.json: the cards the client-side search indexes (SPEC §6).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { sortByTitle } from '../lib/pages';
import { toSearchDoc } from '../lib/search';

export const GET: APIRoute = async () => {
  const cards = sortByTitle((await getCollection('commands')).map((e) => e.data));
  return new Response(JSON.stringify(cards.map(toSearchDoc)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
