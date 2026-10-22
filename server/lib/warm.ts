import { warmCompare } from '../routes/compare';
import { warmSources } from '../routes/sources';

let running: Promise<void> | null = null;

/** Fill the caches for the latest done run and for the sources. Safe to call often; one warm-up runs at a time. */
export function warmAll(): Promise<void> {
  running ??= Promise.all([warmSources(), warmCompare()])
    .then(() => undefined)
    .catch((e: Error) => console.error('[warm]', e.message))
    .finally(() => {
      running = null;
    });
  return running;
}
