import { createApp, analytics, server, serving } from '@databricks/appkit';
import { registerAssistant } from './routes/assistant';
import { registerCsrRun } from './routes/csrRun';
import { registerCsrSignoff } from './routes/csrSignoff';
import { registerDocuments } from './routes/documents';
import { registerDraftRun } from './routes/draftRun';
import { registerDraftSection } from './routes/draftSection';
import { registerGenie } from './routes/genie';
import { registerSearchUntracked } from './routes/searchUntracked';
import { registerSignoff } from './routes/signoff';
import { registerSources } from './routes/sources';
import { registerWordingCheck, warmWordingCheck } from './routes/wordingCheck';

createApp({
  plugins: [analytics(), server(), serving()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      registerWordingCheck(app);
      registerSearchUntracked(app);
      registerSignoff(app);
      registerGenie(app);
      registerDraftSection(app);
      registerDraftRun(app);
      registerAssistant(app);
      registerDocuments(app);
      registerSources(app);
      registerCsrRun(app);
      registerCsrSignoff(app);
    });
    void warmWordingCheck();
  },
}).catch(console.error);
