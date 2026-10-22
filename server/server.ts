import { createApp, analytics, server, serving } from '@databricks/appkit';
import { registerCompare } from './routes/compare';
import { registerCsrRun } from './routes/csrRun';
import { registerCsrSignoff } from './routes/csrSignoff';
import { registerRedeliver } from './routes/redeliver';
import { registerScorecard } from './routes/scorecard';
import { registerSources } from './routes/sources';
import { onRunFinished } from './lib/pod/run';
import { warmAll } from './lib/warm';

createApp({
  plugins: [analytics(), server(), serving()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      registerScorecard(app);
      registerSources(app);
      registerCompare(app);
      registerRedeliver(app);
      registerCsrRun(app);
      registerCsrSignoff(app);
    });
    // Fill the caches for the latest done run and the sources now, again when a run finishes, and every 30 s so a change
    // made out of process (scripts/reset_demo.py supersedes later runs) is picked up.
    void warmAll();
    onRunFinished(() => void warmAll());
    setInterval(() => void warmAll(), 30_000).unref();
  },
}).catch(console.error);
