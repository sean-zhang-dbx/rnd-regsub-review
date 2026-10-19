import type { Application, Request, Response } from 'express';
import { GENIE_SPACE_ID, dbxFetch, userToken, workspaceHost } from '../lib/dbx';

interface GenieMessage {
  id?: string;
  message_id?: string;
  conversation_id: string;
  status: string;
  error?: { error?: string };
  attachments?: {
    attachment_id?: string;
    text?: { content?: string };
    query?: { query?: string; description?: string };
  }[];
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Genie Conversation API. Identity: when the Apps proxy forwards the user's token
 * (x-forwarded-access-token) the question runs as the signed-in user (on behalf of user),
 * otherwise as the app identity.
 */
export function registerGenie(app: Application) {
  app.post('/api/genie/ask', async (req: Request, res: Response) => {
    const question = (req.body as { question?: unknown })?.question;
    if (typeof question !== 'string' || question.trim().length === 0 || question.length > 1000) {
      res.status(400).json({ error: 'question must be a non-empty string' });
      return;
    }
    const token = userToken(req);
    try {
      const base = `/api/2.0/genie/spaces/${GENIE_SPACE_ID}`;
      const start = await dbxFetch<{ conversation_id: string; message_id: string }>(
        `${base}/start-conversation`,
        { body: { content: question }, token },
      );
      const msgPath = `${base}/conversations/${start.conversation_id}/messages/${start.message_id}`;
      let msg = await dbxFetch<GenieMessage>(msgPath, { token });
      const deadline = Date.now() + 110_000;
      while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(msg.status) && Date.now() < deadline) {
        await sleep(1500);
        msg = await dbxFetch<GenieMessage>(msgPath, { token });
      }
      if (msg.status !== 'COMPLETED') {
        res.status(502).json({ error: `Genie ${msg.status}: ${msg.error?.error ?? 'no answer'}` });
        return;
      }
      const textAtt = msg.attachments?.find((a) => a.text?.content);
      const queryAtt = msg.attachments?.find((a) => a.query?.query);
      let rows: Record<string, string | null>[] = [];
      if (queryAtt?.attachment_id) {
        const qr = await dbxFetch<{
          statement_response?: {
            manifest?: { schema?: { columns?: { name: string }[] } };
            result?: { data_array?: (string | null)[][] };
          };
        }>(`${msgPath}/attachments/${queryAtt.attachment_id}/query-result`, { token });
        const cols = qr.statement_response?.manifest?.schema?.columns?.map((c) => c.name) ?? [];
        rows = (qr.statement_response?.result?.data_array ?? []).map((r) =>
          Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])),
        );
      }
      res.json({
        answer_text: textAtt?.text?.content ?? queryAtt?.query?.description ?? '',
        sql: queryAtt?.query?.query ?? '',
        rows,
        conversation_url: `${workspaceHost()}/genie/rooms/${GENIE_SPACE_ID}/chats/${start.conversation_id}`,
      });
    } catch (e) {
      console.error('[genie]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
