// Links to the GitHub repository. Contributions go through prefilled issue
// forms (SPEC §2.9): .github/ISSUE_TEMPLATE/*.yml. GitHub fills a form field
// from the query parameter named after its `id`; tests/lib/github.test.ts
// checks those ids exist in the forms.
import { sanitizeValue } from './copy';

export const REPO_URL = 'https://github.com/jeremychenet/GrepMeIfYouCan';
export const SUGGEST_TEMPLATE = 'suggest-command.yml';
export const REPORT_TEMPLATE = 'report-issue.yml';

const QUERY_MAX = 100;

function newIssueUrl(fields: Record<string, string>): string {
  return `${REPO_URL}/issues/new?${new URLSearchParams(fields)}`;
}

/**
 * New command suggestion. From a search that found nothing, the query goes in
 * the issue title and in the card's Title field (`card-title`: `title` is the
 * issue title); without a query (global button), a blank form.
 */
export function suggestCommandUrl(query = ''): string {
  const q = sanitizeValue(query).trim().slice(0, QUERY_MAX);
  if (!q) return newIssueUrl({ template: SUGGEST_TEMPLATE, title: 'Suggest a command' });
  return newIssueUrl({ template: SUGGEST_TEMPLATE, title: `Suggest a command: ${q}`, 'card-title': q });
}

/** Problem report about a card, from its page. */
export function reportIssueUrl(cardId: string, pageUrl: string): string {
  return newIssueUrl({ template: REPORT_TEMPLATE, title: `Report: ${cardId}`, card: cardId, page: pageUrl });
}
