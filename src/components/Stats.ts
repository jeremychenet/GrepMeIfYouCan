// Browser side of src/lib/analytics.ts: reads the Umami tracker from the page
// at the time of each event (the script is deferred and may never load).
import { track, type AnalyticsEvent, type EventData, type Tracker } from '../lib/analytics';

export function trackEvent(name: AnalyticsEvent, data?: EventData): void {
  track((window as Window & { umami?: Tracker }).umami, name, data);
}
