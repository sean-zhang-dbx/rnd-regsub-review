import { createApp, analytics, server, serving } from '@databricks/appkit';
import { registerGenie } from './routes/genie';
import { registerSearchUntracked } from './routes/searchUntracked';
import { registerSignoff } from './routes/signoff';
import { registerWordingCheck, warmWordingCheck } from './routes/wordingCheck';

createApp({
  plugins: [analytics(), server(), serving()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      registerWordingCheck(app);
      registerSearchUntracked(app);
      registerSignoff(app);
      registerGenie(app);
    });
    void warmWordingCheck();
  },
}).catch(console.error);
