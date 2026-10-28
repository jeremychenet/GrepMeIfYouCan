// Audience statistics through self-hosted Umami (SPEC §6.4): page views plus
// three anonymous events. Everything here is optional: when the Umami script
// is missing, blocked or down, `track` does nothing and never throws.
import { classify } from './unsafe-chars';

export type AnalyticsEvent = 'copy' | 'favorite' | 'search_no_result';
export type EventData = Record<string, string>;

/** The part of the Umami tracker (`window.umami`) the site uses. */
export interface Tracker {
  track(name: string, data?: EventData): unknown;
}

/** Longest query sent with `search_no_result` (SPEC §6.4), in characters. */
export const QUERY_MAX = 100;
/** Shortest query worth reporting: one letter is still being typed. */
export const QUERY_MIN = 2;
/** A query is reported once the user stopped typing for this long. */
export const NO_RESULT_DELAY_MS = 1500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads PUBLIC_UMAMI_WEBSITE_ID (the id Umami gives the site). Without it the
 * tracker script is not added to the pages at all.
 */
export function umamiWebsiteId(env: Record<string, string | undefined>): string | undefined {
  const raw = env['PUBLIC_UMAMI_WEBSITE_ID']?.trim();
  if (!raw) return undefined;
  if (!UUID.test(raw)) throw new Error(`PUBLIC_UMAMI_WEBSITE_ID must be a UUID, got "${raw}"`);
  return raw.toLowerCase();
}

/** Sends an event if Umami is loaded; never throws, never waits. */
export function track(tracker: Tracker | undefined, name: AnalyticsEvent, data?: EventData): void {
  try {
    const sent = tracker?.track(name, data);
    // Umami returns a promise: a failed request must not become an unhandled rejection.
    if (sent instanceof Promise) sent.catch(() => {});
  } catch {
    // Statistics never break the page.
  }
}

/**
 * The query as reported: invisible and control characters removed, spaces
 * collapsed, lower case, at most QUERY_MAX characters.
 */
export function cleanQuery(query: string): string {
  const visible = [...query].map((ch) => {
    const kind = classify(ch.codePointAt(0)!);
    if (kind === 'newline' || kind === 'control') return ' ';
    return kind ? '' : ch;
  });
  const text = visible.join('').replace(/\s+/g, ' ').trim().toLowerCase();
  return [...text].slice(0, QUERY_MAX).join('').trimEnd();
}

export interface NoResultOptions {
  send: (query: string) => void;
  delay?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface NoResultReporter {
  /** Called after each search with the query and its number of results. */
  update(query: string, results: number): void;
}

/**
 * Reports searches without result once the user paused typing, so that
 * "gr", "gre", "grep" are not all counted. Each query is sent once per page.
 */
export function createNoResultReporter({
  send,
  delay = NO_RESULT_DELAY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: NoResultOptions): NoResultReporter {
  const reported = new Set<string>();
  let pending: unknown;

  return {
    update(query, results) {
      if (pending !== undefined) clearTimer(pending);
      pending = undefined;
      const clean = cleanQuery(query);
      if (results > 0 || [...clean].length < QUERY_MIN || reported.has(clean)) return;
      pending = setTimer(() => {
        pending = undefined;
        reported.add(clean);
        send(clean);
      }, delay);
    },
  };
}
