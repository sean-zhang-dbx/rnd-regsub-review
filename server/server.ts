import { createApp, analytics, server, serving } from '@databricks/appkit';

createApp({
  plugins: [
    analytics(),
    server(),
    serving(),
  ],
}).catch(console.error);
