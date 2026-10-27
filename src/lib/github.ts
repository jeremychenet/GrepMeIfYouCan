// Links to the GitHub repository. Contributions go through issues (SPEC §5);
// the prefilled issue forms arrive in J15.
export const REPO_URL = 'https://github.com/jeremychenet/GrepMeIfYouCan';

const TITLE_QUERY_MAX = 100;

/** New issue suggesting a command for a search that found nothing. */
export function suggestCommandUrl(query: string): string {
  const q = query.trim().slice(0, TITLE_QUERY_MAX);
  const params = new URLSearchParams({ title: q ? `Suggest a command: ${q}` : 'Suggest a command' });
  return `${REPO_URL}/issues/new?${params}`;
}
