import { createApp, analytics, server, serving } from '@databricks/appkit';
import { registerCompare } from './routes/compare';
import { registerCsrRun } from './routes/csrRun';
import { registerCsrSignoff } from './routes/csrSignoff';
import { registerRedeliver } from './routes/redeliver';
import { registerScorecard } from './routes/scorecard';
import { registerSources } from './routes/sources';

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
  },
}).catch(console.error);
