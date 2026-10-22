import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { Accountability } from '../components/signoff/Accountability';
import { EMPTY_LIVE, reduceEvent } from '../components/pod/model';
import type { RunLive } from '../components/pod/model';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import { exportUrl, getActiveRun, getPod, getRedeliverLatest, getSignoffs, postRedeliver, postSignoff, subscribeRun } from '../data/api';
import type { Redelivery as RedeliveryData } from '../data/types';
import { useScorecard } from '../hooks/scorecard';
import { useAsync } from '../hooks/useAsync';
import { ScoreHead, ScoreLine } from './Scorecard';
import { XRayMarker } from '../xray/XRay';

const TABLE = 'Table 14-5.01';

function Step({ state, children }: { state: 'waiting' | 'running' | 'done'; children: ReactNode }) {
  return (
    <li className={cn('flex items-center gap-2 text-[14px]', state === 'waiting' && 'text-muted-foreground')}>
      <span className={cn('size-2 rounded-full', state === 'done' ? 'bg-match' : state === 'running' ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
      {children}
      <span className="text-[12px] text-muted-foreground">{state === 'running' ? 'running' : state === 'done' ? 'done' : ''}</span>
    </li>
  );
}

export function Redelivery() {
  const sc = useScorecard();
  const pod = useAsync(getPod);
  const runId = sc.data?.run.run_id ?? null;
  const signoffs = useAsync(() => (runId ? getSignoffs(runId) : Promise.resolve(null)), [runId]);

  const [result, setResult] = useState<RedeliveryData | null>(null);
  const attachedAt = useRef(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<RunLive>(EMPTY_LIVE);
  const [activeId, setActiveId] = useState<string | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  const reloadScore = sc.reload;

  useEffect(() => () => unsub.current?.(), []);

  /* The button is off while any run is active, including one started elsewhere. */
  useEffect(() => {
    let alive = true;
    const poll = () =>
      void getActiveRun().then(
        (id) => {
          if (!alive) return;
          setActiveId(id);
          /* A run that is no longer active has ended, even if its last event never reached this page. */
          if (!id && Date.now() - attachedAt.current > 5000) {
            setLive((s) => (s.status === 'running' ? { ...s, status: 'done' } : s));
          }
        },
        () => undefined,
      );
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  /* Restore the last result so a reload keeps the payoff. A run that is still going is followed again. */
  const restored = useRef(false);
  const attachRef = useRef<(id: string) => void>(() => undefined);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    getRedeliverLatest().then(
      (r) => {
        if (!r) return;
        setResult(r);
        if (r.run_id && r.run_status === 'running') attachRef.current(r.run_id);
        else if (r.run_id) setLive({ ...EMPTY_LIVE, runId: r.run_id, status: 'done', agents: { author: { status: 'done' }, qc: { status: 'done' } } });
      },
      () => undefined,
    );
  }, []);

  const attach = useCallback(
    (id: string) => {
      attachedAt.current = Date.now();
      setLive({ ...EMPTY_LIVE, runId: id, status: 'running' });
      unsub.current?.();
      unsub.current = subscribeRun(
        id,
        (e) => {
          setLive((s) => reduceEvent(s, e));
          if (e.type === 'run' && e.status !== 'running') {
            unsub.current?.();
            if (e.status === 'error') setError(e.error ?? 'The redraft stopped with an error.');
            reloadScore();
            setActiveId(null);
          }
        },
        () => setError('The connection to the redraft was lost. Reload to see where it stands.'),
      );
    },
    [reloadScore],
  );

  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);

  async function redeliver() {
    setError(null);
    setStarting(true);
    try {
      const r = await postRedeliver();
      setResult(r);
      if (r.run_id) attach(r.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The re-delivery could not start.');
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || !!activeId || live.status === 'running';
  const differing = sc.data?.rows.filter((r) => r.status === 'differs') ?? [];
  const affectedSections = new Set(result?.affected.map((a) => a.section));
  const shown = sc.data?.rows.filter((r) => r.status === 'differs' || affectedSections.has(r.section)) ?? [];
  const sentences = result ? new Set(result.affected.map((a) => `${a.section}:${a.sentence_idx}`)).size : 0;
  const authorState = live.agents.author?.status;
  const qcState = live.agents.qc?.status;
  const step = (s?: string): 'waiting' | 'running' | 'done' => (s === 'done' ? 'done' : s === 'running' ? 'running' : 'waiting');

  return (
    <div className="w-full max-w-[1760px] space-y-6">
      <Panel>
        <XRayMarker id="redelivery" />
        <div className="p-6 pr-12">
          {result ? (
            <p role="status" className="max-w-[900px] text-[22px] leading-snug font-semibold tracking-[-0.01em]">
              Biostatistics re-delivered {TABLE} (version {result.new_version}: treatment-emergent events only).{' '}
              <span className="num">{sentences}</span> {sentences === 1 ? 'sentence quotes' : 'sentences quote'} changed cells. Demo scenario: the data is unchanged; version {result.old_version} used an incorrect derivation.
            </p>
          ) : (
            <h1 className="max-w-[900px] text-[22px] leading-snug font-semibold tracking-[-0.01em]">
              {differing.length > 0 ? `${TABLE} version 1 counted all adverse events. The draft of ${differing[0].section} quotes it.` : 'No section differs from the submitted CSR.'}
            </h1>
          )}
          <div className="mt-4 flex items-center gap-4">
            <Button className="rounded-control" disabled={busy || !!result || differing.length === 0} onClick={() => void redeliver()}>
              {starting ? 'Starting' : busy ? 'A run is active' : result ? `${TABLE} re-delivered` : `Biostatistics re-delivers ${TABLE}`}
            </Button>
            {busy && !starting ? <p className="text-[13px] text-muted-foreground">The button is off until the run ends.</p> : null}
          </div>
          {error ? <p role="alert" className="mt-3 text-[14px] text-differs">{error}</p> : null}
        </div>

        {result ? (
          <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-8 border-t border-border p-6">
            <div>
              <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Sentences that quote changed cells</h2>
              <div className="max-h-[220px] overflow-y-auto" data-testid="changed-cells">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="text-left text-[13px] text-muted-foreground">
                    <th className="sticky top-0 bg-card py-1 font-normal">Section</th>
                    <th className="sticky top-0 bg-card py-1 font-normal">Sentence</th>
                    <th className="sticky top-0 bg-card py-1 font-normal">Figure</th>
                    <th className="sticky top-0 bg-card py-1 text-right font-normal">Was</th>
                    <th className="sticky top-0 bg-card py-1 text-right font-normal">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {result.affected.map((a) => (
                    <tr key={`${a.section}-${a.sentence_idx}-${a.slot}`} className="border-t border-border/70">
                      <td className="num py-1.5">{a.section}</td>
                      <td className="num py-1.5">{a.sentence_idx + 1}</td>
                      <td className="py-1.5 pr-3 text-[13px]">{a.label || a.slot.replace(/_/g, ' ')}</td>
                      <td className="num py-1.5 text-right text-differs line-through">{a.old_value}</td>
                      <td className="num py-1.5 text-right">{a.new_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Redraft of {[...affectedSections].join(', ')}</h2>
              <ol className="space-y-2">
                <Step state="done">Figures recomputed from version {result.new_version}</Step>
                <Step state={step(authorState)}>Wording redrafted</Step>
                <Step state={step(qcState)}>Scored against the submitted CSR</Step>
              </ol>
            </div>
          </div>
        ) : null}
      </Panel>

      <div>
        {sc.loading ? (
          <LoadingBlock rows={2} />
        ) : sc.error || !sc.data ? (
          <ErrorBlock title="The scorecard could not be loaded" detail={sc.error} onRetry={sc.retry} />
        ) : shown.length > 0 ? (
          <Panel>
            <ScoreHead />
            {shown.map((r) => (
              <ScoreLine key={r.section} r={r} />
            ))}
          </Panel>
        ) : null}
      </div>

      {pod.loading || signoffs.loading ? (
        <LoadingBlock rows={4} />
      ) : pod.error || !pod.data ? (
        <ErrorBlock title="The departments could not be loaded" detail={pod.error} onRetry={pod.retry} />
      ) : !runId ? (
        <EmptyBlock title="No finished run to sign">Sign-off opens once the pod has drafted the CSR.</EmptyBlock>
      ) : (
        <>
          {signoffs.error ? <ErrorBlock title="The sign-offs could not be loaded" detail={signoffs.error} onRetry={signoffs.retry} /> : null}
          <Accountability
            pod={pod.data}
            runId={runId}
            state={signoffs.data}
            exportHref={exportUrl(runId)}
            onSign={async (department, decision) => {
              await postSignoff({ run_id: runId, department, decision });
              signoffs.reload();
            }}
          />
        </>
      )}
    </div>
  );
}
