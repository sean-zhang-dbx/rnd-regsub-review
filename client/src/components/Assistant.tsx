import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Textarea } from '@databricks/appkit-ui/react';
import { LoaderCircle, Mic, Send, X } from 'lucide-react';
import { streamAssistant } from '../data/api';
import type { AssistantGenie, AssistantSource, SourcePage } from '../data/types';
import { DbxLink } from '../lib/presenter';
import { ParsedPage } from './ParsedPage';

export const SUGGESTED = [
  'How many participants in the treatment arm met the primary endpoint after the restatement?',
  'How does the SAP handle missing Week 52 assessments?',
  'Which documents outside the dossier still quote 412 of 618?',
];

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  route?: { tables: boolean; documents: boolean };
  sources?: AssistantSource[];
  genie?: AssistantGenie | null;
  error?: string;
}

/* Web Speech API (Chrome). Speech is transcribed by the browser's speech service before the question is sent. */
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };
function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Cited({ text, sources, onOpen }: { text: string; sources: AssistantSource[]; onOpen: (s: AssistantSource) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="leading-relaxed">
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        const src = m ? sources.find((s) => s.n === Number(m[1])) : undefined;
        return src ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(src)}
            title={`${src.doc_title}, page ${src.page}`}
            className="mx-0.5 rounded-[3px] bg-cited-soft px-1 align-baseline text-[11px] font-semibold text-cited hover:underline"
          >
            {src.n}
          </button>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </p>
  );
}

function GenieBlock({ g }: { g: AssistantGenie }) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-page p-2.5">
      <p className="text-xs font-semibold text-ink">Genie Agent, certified tables</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-cited underline underline-offset-4">Show SQL</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-[var(--radius)] bg-muted p-2 font-mono text-[11px] leading-relaxed">{g.sql}</pre>
      </details>
    </div>
  );
}

/**
 * Reviewer assistant, a drawer over the Information panel. Each question goes to the Genie Agent (certified
 * tables), AI Search (parsed documents) or both, and the answer cites its sources; a cited page opens in the
 * middle pane with its ai_parse_document layout.
 */
export function AssistantDrawer({
  open,
  onClose,
  onShowSource,
  onAnswered,
  initialQuestion,
}: {
  open: boolean;
  onClose: () => void;
  onShowSource: (p: SourcePage) => void;
  onAnswered: () => void;
  initialQuestion?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialQuestion ?? '');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const genieConv = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const Speech = speechRecognition();

  useEffect(() => {
    if (open && initialQuestion && msgs.length === 0) setInput(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuestion]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [msgs]);

  function update(fn: (m: Msg) => Msg) {
    setMsgs((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '', status: 'Choosing sources' }]);
    setInput('');
    setBusy(true);
    try {
      await streamAssistant({ question: q, history, genie_conversation_id: genieConv.current }, (e) => {
        if (e.event === 'route') {
          const parts = [e.tables ? 'asking the Genie Agent' : '', e.documents ? 'searching the documents' : ''].filter(Boolean);
          update((m) => ({ ...m, route: { tables: e.tables, documents: e.documents }, status: parts.join(' and ').replace(/^./, (c) => c.toUpperCase()) }));
        } else if (e.event === 'tables' && e.genie) {
          genieConv.current = e.genie.conversation_id;
        } else if (e.event === 'answer') {
          update((m) => ({ ...m, content: e.answer, sources: e.sources, genie: e.genie, status: undefined }));
          if (e.genie) onAnswered();
        } else if (e.event === 'error') {
          update((m) => ({ ...m, status: undefined, error: e.error }));
        }
      });
    } catch (err) {
      update((m) => ({ ...m, status: undefined, error: err instanceof Error ? err.message : 'The assistant did not answer.' }));
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (!Speech) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = 'en-GB';
    r.interimResults = false;
    r.onresult = (e) => setInput((v) => `${v ? `${v} ` : ''}${e.results[0][0].transcript}`);
    r.onend = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  }

  if (!open) return null;
  return (
    <aside
      aria-label="Reviewer assistant"
      className="absolute inset-y-0 right-0 z-30 flex w-[23rem] flex-col border-l border-line bg-page shadow-[-12px_0_24px_-12px_rgba(16,24,40,0.25)]"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Reviewer assistant</h2>
          <p className="text-xs text-ink-muted">Genie Agent for the certified tables, AI Search for the documents</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close the assistant" onClick={onClose} className="size-8 text-ink-muted">
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {msgs.length === 0 ? (
          <div className="space-y-2">
            <p className="text-ink-muted">Ask about the results in the certified tables or about what the source documents say.</p>
            {SUGGESTED.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="block w-full rounded-[var(--radius)] border border-line px-3 py-2 text-left text-[13px] text-ink hover:bg-desk"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-8 rounded-[var(--radius)] bg-cited-soft px-3 py-2 text-ink">
              {m.content}
            </div>
          ) : (
            <Answer key={i} m={m} onOpen={(s) => s.view && onShowSource({ ...s.view, used_label: 'cited in the answer' })} />
          ),
        )}
        <div ref={endRef} />
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          rows={2}
          placeholder="Ask about the data or the documents"
          className="resize-none bg-page text-[13px] leading-snug md:text-[13px]"
          aria-label="Question for the reviewer assistant"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <DbxLink linkKey="beat4_genie" label="Genie Agent" />
            <DbxLink linkKey="beat1_search" label="AI Search index" />
            <DbxLink linkKey="beat3_traces" label="Traces" />
          </div>
          <div className="flex gap-2">
            {Speech ? (
              <Button type="button" variant="outline" size="icon" aria-label={listening ? 'Stop listening' : 'Speak a question'} onClick={toggleMic} className={`size-8 ${listening ? 'border-cited text-cited' : 'text-ink-muted'}`}>
                <Mic className="size-4" />
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={busy || input.trim() === ''}>
              <Send className="mr-1 size-3.5" /> Ask
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Answer({ m, onOpen }: { m: Msg; onOpen: (s: AssistantSource) => void }): ReactNode {
  const sources = m.sources ?? [];
  return (
    <div className="mr-4 space-y-2.5">
      {m.route ? (
        <div className="flex gap-1.5 text-[11px]">
          {m.route.tables ? <span className="rounded-full bg-muted px-2 py-0.5 text-ink-muted">Certified tables</span> : null}
          {m.route.documents ? <span className="rounded-full bg-muted px-2 py-0.5 text-ink-muted">Source documents</span> : null}
        </div>
      ) : null}
      {m.status ? (
        <p className="flex items-center gap-2 text-ink-muted">
          <LoaderCircle className="size-4 animate-spin text-cited" aria-hidden="true" />
          {m.status}
        </p>
      ) : null}
      {m.error ? <p className="text-attention">The assistant did not answer: {m.error}</p> : null}
      {m.content ? <Cited text={m.content} sources={sources} onOpen={onOpen} /> : null}
      {m.genie ? <GenieBlock g={m.genie} /> : null}
      {sources.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {sources.map((s) => (
            <button key={s.n} type="button" onClick={() => onOpen(s)} className="rounded-[var(--radius)] border border-line p-1.5 text-left hover:bg-desk" title="Open the page">
              {s.view ? <ParsedPage page={s.view} compact /> : null}
              <span className="mt-1 block text-[11px] leading-tight text-ink-muted">
                <span className="font-semibold text-cited">{s.n}</span> {s.doc_title}, p. {s.page}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
