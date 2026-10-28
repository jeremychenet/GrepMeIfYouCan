import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_RESULT_DELAY_MS,
  QUERY_MAX,
  cleanQuery,
  createNoResultReporter,
  track,
  umamiWebsiteId,
} from '../../src/lib/analytics';

const ID = 'b59e9c65-ae32-47f1-8400-119fcf4861c4';

describe('umamiWebsiteId', () => {
  it('is undefined when not set', () => {
    expect(umamiWebsiteId({})).toBeUndefined();
    expect(umamiWebsiteId({ PUBLIC_UMAMI_WEBSITE_ID: '  ' })).toBeUndefined();
  });

  it('returns the id, trimmed and in lower case', () => {
    expect(umamiWebsiteId({ PUBLIC_UMAMI_WEBSITE_ID: ` ${ID.toUpperCase()} ` })).toBe(ID);
  });

  it('rejects anything that is not a UUID', () => {
    for (const bad of ['abc', `${ID}x`, `"${ID}"`, `${ID}" onload="x`]) {
      expect(() => umamiWebsiteId({ PUBLIC_UMAMI_WEBSITE_ID: bad })).toThrow(/PUBLIC_UMAMI_WEBSITE_ID/);
    }
  });
});

describe('track', () => {
  it('forwards the event to Umami', () => {
    const tracker = { track: vi.fn() };
    track(tracker, 'copy', { id: 'ls-all' });
    expect(tracker.track).toHaveBeenCalledWith('copy', { id: 'ls-all' });
  });

  it('does nothing without Umami', () => {
    expect(() => track(undefined, 'copy', { id: 'ls-all' })).not.toThrow();
  });

  it('never throws when Umami fails', async () => {
    expect(() =>
      track({ track: () => { throw new Error('boom'); } }, 'favorite', { id: 'x' }),
    ).not.toThrow();
    const rejected = Promise.reject(new Error('network'));
    const catchSpy = vi.spyOn(rejected, 'catch');
    track({ track: () => rejected }, 'favorite');
    expect(catchSpy).toHaveBeenCalled();
    await expect(rejected).rejects.toThrow('network');
  });
});

describe('cleanQuery', () => {
  it('collapses spaces, trims and lowers case', () => {
    expect(cleanQuery('  Find   Large\tFiles ')).toBe('find large files');
  });

  it('removes invisible and bidi characters, turns control characters into spaces', () => {
    const zwsp = String.fromCodePoint(0x200b);
    const rlo = String.fromCodePoint(0x202e);
    expect(cleanQuery(`gr${zwsp}ep${rlo}`)).toBe('grep');
    expect(cleanQuery(`tar${String.fromCodePoint(0x07)}x\nz`)).toBe('tar x z');
  });

  it(`keeps at most ${QUERY_MAX} characters, counting code points`, () => {
    expect(cleanQuery('a'.repeat(150))).toHaveLength(QUERY_MAX);
    const emoji = String.fromCodePoint(0x1f600);
    expect([...cleanQuery(emoji.repeat(150))]).toHaveLength(QUERY_MAX);
    expect(cleanQuery(`${'a'.repeat(99)} b`)).toBe('a'.repeat(99));
  });
});

describe('createNoResultReporter', () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const send = vi.fn();
    return { send, reporter: createNoResultReporter({ send }) };
  }

  it('sends the cleaned query once the user paused typing', () => {
    const { send, reporter } = setup();
    reporter.update('  Kubectl Foo ', 0);
    vi.advanceTimersByTime(NO_RESULT_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledExactlyOnceWith('kubectl foo');
  });

  it('only sends the last query while typing', () => {
    const { send, reporter } = setup();
    for (const q of ['zz', 'zzq', 'zzqx']) {
      reporter.update(q, 0);
      vi.advanceTimersByTime(500);
    }
    vi.advanceTimersByTime(NO_RESULT_DELAY_MS);
    expect(send).toHaveBeenCalledExactlyOnceWith('zzqx');
  });

  it('cancels when results come back or the query gets too short', () => {
    const { send, reporter } = setup();
    reporter.update('zzq', 0);
    reporter.update('zzq', 3);
    reporter.update('z', 0);
    reporter.update('  ', 0);
    vi.advanceTimersByTime(NO_RESULT_DELAY_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends each query once per page', () => {
    const { send, reporter } = setup();
    reporter.update('zzq', 0);
    vi.advanceTimersByTime(NO_RESULT_DELAY_MS);
    reporter.update('ZZQ ', 0);
    vi.advanceTimersByTime(NO_RESULT_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('accepts custom timers', () => {
    const timers: Array<() => void> = [];
    const send = vi.fn();
    const clearTimer = vi.fn();
    const reporter = createNoResultReporter({
      send,
      setTimer: (fn) => timers.push(fn),
      clearTimer,
    });
    reporter.update('zzq', 0);
    reporter.update('zzqx', 0);
    expect(clearTimer).toHaveBeenCalledWith(1);
    timers[1]!();
    expect(send).toHaveBeenCalledExactlyOnceWith('zzqx');
  });
});
