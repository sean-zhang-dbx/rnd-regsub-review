import * as mlflow from 'mlflow-tracing';
import { ServiceContext } from '@databricks/appkit';

/** MLflow experiment /Users/sean.zhang@databricks.com/rnd_regsub_review */
export const EXPERIMENT_ID = process.env.MLFLOW_EXPERIMENT_ID ?? '1752849192687853';

let ready = false;
let failed = false;

/** Initialise MLflow tracing once. Never throws: tracing must not break the review flow. */
export async function initTracing(): Promise<boolean> {
  if (ready) return true;
  if (failed) return false;
  try {
    if (process.env.DATABRICKS_CLIENT_ID) {
      // Databricks Apps: the runtime injects the service principal credentials. DATABRICKS_HOST
      // comes without a scheme there, and mlflow-tracing builds the request URL from it as is.
      const host = process.env.DATABRICKS_HOST ?? '';
      mlflow.init({
        trackingUri: 'databricks',
        experimentId: EXPERIMENT_ID,
        host: /^https?:\/\//.test(host) ? host : `https://${host}`,
      });
    } else {
      // Local development: the CLI profile has two entries for this host, so pass the token explicitly.
      const w = ServiceContext.get().client;
      const headers = new Headers();
      await w.config.authenticate(headers);
      const token = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      mlflow.init({
        trackingUri: 'databricks',
        experimentId: EXPERIMENT_ID,
        host: w.config.host,
        databricksToken: token,
      });
    }
    ready = true;
  } catch (e) {
    failed = true;
    console.warn('[tracing] MLflow init failed, continuing without traces:', (e as Error).message);
  }
  return ready;
}

export { mlflow };
