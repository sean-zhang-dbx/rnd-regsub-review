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

export interface GenieAnswer {
  answer_text: string;
  sql: string;
  rows: Record<string, string | null>[];
  conversation_id: string;
  conversation_url: string;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Ask the Genie Agent through the Conversation API, in a new conversation or as a follow-up in an
 * existing one. Identity: with the user's token (x-forwarded-access-token from the Apps proxy) the
 * question runs as the signed-in user (on behalf of user), otherwise as the app identity.
 */
export async function askGenie(question: string, token?: string, conversationId?: string): Promise<GenieAnswer> {
  const base = `/api/2.0/genie/spaces/${GENIE_SPACE_ID}`;
  const start = conversationId
    ? await dbxFetch<{ conversation_id: string; message_id?: string; id?: string }>(`${base}/conversations/${conversationId}/messages`, {
        body: { content: question },
        token,
      })
    : await dbxFetch<{ conversation_id: string; message_id: string }>(`${base}/start-conversation`, {
        body: { content: question },
        token,
      });
  const cid = start.conversation_id ?? conversationId;
  const mid = start.message_id ?? (start as { id?: string }).id;
  const msgPath = `${base}/conversations/${cid}/messages/${mid}`;
  let msg = await dbxFetch<GenieMessage>(msgPath, { token });
  const deadline = Date.now() + 110_000;
  while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(msg.status) && Date.now() < deadline) {
    await sleep(1500);
    msg = await dbxFetch<GenieMessage>(msgPath, { token });
  }
  if (msg.status !== 'COMPLETED') throw new Error(`Genie ${msg.status}: ${msg.error?.error ?? 'no answer'}`);
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
    rows = (qr.statement_response?.result?.data_array ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])));
  }
  return {
    answer_text: textAtt?.text?.content ?? queryAtt?.query?.description ?? '',
    sql: queryAtt?.query?.query ?? '',
    rows,
    conversation_id: cid,
    conversation_url: `${workspaceHost()}/genie/rooms/${GENIE_SPACE_ID}/chats/${cid}`,
  };
}

export function registerGenie(app: Application) {
  app.post('/api/genie/ask', async (req: Request, res: Response) => {
    const question = (req.body as { question?: unknown })?.question;
    if (typeof question !== 'string' || question.trim().length === 0 || question.length > 1000) {
      res.status(400).json({ error: 'question must be a non-empty string' });
      return;
    }
    try {
      res.json(await askGenie(question, userToken(req)));
    } catch (e) {
      console.error('[genie]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
