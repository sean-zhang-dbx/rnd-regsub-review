import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronUp, Download, FileText, LoaderCircle, Play } from 'lucide-react';
import { Accountability } from '../components/csr/Accountability';
import { AgentDrawer } from '../components/csr/AgentDrawer';
import { CsrDocumentView } from '../components/csr/CsrDocumentView';
import { EMPTY_LIVE, AGENT_LABEL, formatDuration, reduceEvent } from '../components/csr/model';
import type { RunLive } from '../components/csr/model';
import { PodFlow } from '../components/csr/PodFlow';
import { RedeliveryBanner } from '../components/csr/RedeliveryBanner';
import { SectionInspector, ConfigLink } from '../components/csr/SectionInspector';
import { SectionTree } from '../components/csr/SectionTree';
import type { TreeRow } from '../components/csr/SectionTree';
import { EmptyNote, ErrorNote } from '../components/QueryBoundary';
import { exportUrl, getActiveRun, getLatestRun, getPod, getRegistry, getRun, getSignoffs, postSignoff, startRun, subscribeRun } from '../data/csr';
import type { AgentId, CsrDocument, PodDef, RegistrySection, SignoffState } from '../data/csr';
import { cn } from '../lib/utils';
import { STUDY } from '../lib/format';
import { useAsync } from '../lib/useAsync';

/*
 * The whole CSR, drafted by the CSR Pod (docs/CSR_POD_BUILD.md section 4): the pod on top, then the
 * workspace (sections, document, inspector), then who is accountable and who has signed.
 */

function PodSkeleton() {
  return (
    <div className="flex gap-4" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-44 flex-1" />
      ))}
    </div>
  );
}

function PlanTable({ rows, live }: { rows: RegistrySection[]; live: RunLive }) {
  return (
    <div className="bg-page p-6">
      <h3 className="text-base font-semibold text-ink">{live.runId ? 'The CSR Pod is drafting' : 'No draft yet'}</h3>
      <p className="mt-1 mb-4 text-sm text-ink-muted">
        {live.runId
          ? 'The document appears here when the run finishes. Sections update as each agent saves.'
          : `The Document Planner reads this section registry, then the agents draft ${rows.filter((r) => r.kind === 'drafted' || r.kind === 'narrative').length} sections in parallel waves. Select Draft the whole CSR to start.`}
      </p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] tracking-wide text-ink-muted uppercase">
            <th className="py-1.5 pr-2 font-semibold">Section</th>
            <th className="py-1.5 pr-2 font-semibold">Title</th>
            <th className="py-1.5 pr-2 font-semibold">Agent</th>
            <th className="py-1.5 pr-2 font-semibold">Department</th>
            <th className="py-1.5 text-right font-semibold">Wave</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.section} className="border-b border-line/60">
              <td className="py-1.5 pr-2 font-semibold text-ink-muted">{r.section}</td>
              <td className="py-1.5 pr-2 text-ink">{r.title}</td>
              <td className="py-1.5 pr-2 text-ink-muted">{AGENT_LABEL[r.agent] ?? r.agent}</td>
              <td className="py-1.5 pr-2 text-ink-muted">{r.department}</td>
              <td className="py-1.5 text-right text-ink-muted">{r.wave ?? 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodStrip({ pod, live, onExpand }: { pod: PodDef; live: RunLive; onExpand: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border border-line bg-page px-4 py-2 shadow-sm">
      <ol className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]">
        {pod.columns.map((c, i) => {
          const states = c.members.map((m) => live.agents[m]?.status);
          const running = states.includes('running');
          const done = states.length > 0 && states.every((s) => s === 'done');
          return (
            <li key={c.title} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-line">&rarr;</span> : null}
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium', running ? 'bg-cited-soft text-cited' : done ? 'bg-recomputed-soft text-recomputed' : 'bg-open-soft text-ink-muted')}>
                {running ? <span className="size-1.5 animate-pulse rounded-full bg-cited" /> : null}
                {c.title}
              </span>
            </li>
          );
        })}
      </ol>
      <Button size="sm" variant="outline" onClick={onExpand}>
        <ChevronDown className="mr-1 size-4" />
        Show the pod
      </Button>
    </div>
  );
}

export function Csr() {
  const pod = useAsync<PodDef>(getPod);
  const registry = useAsync<RegistrySection[]>(getRegistry);
  const latest = useAsync<CsrDocument | null>(getLatestRun);

  const [doc, setDoc] = useState<CsrDocument | null>(null);
  const [live, setLive] = useState<RunLive>(EMPTY_LIVE);
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drawer, setDrawer] = useState<AgentId | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignoffState | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  const docPane = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (latest.data) setDoc((d) => d ?? latest.data);
  }, [latest.data]);
  useEffect(() => () => unsub.current?.(), []);

  const running = live.status === 'running' || starting;
  const runId = doc?.run_id ?? null;

  const refreshSignoffs = useCallback(async (id: string) => {
    try {
      setSignoffs(await getSignoffs(id));
    } catch {
      setSignoffs(null);
    }
  }, []);
  useEffect(() => {
    if (runId) void refreshSignoffs(runId);
    else setSignoffs(null);
  }, [runId, refreshSignoffs]);

  const finish = useCallback(async (id: string) => {
    unsub.current?.();
    unsub.current = null;
    try {
      const d = await getRun(id);
      setDoc(d);
      setSelected((s) => s ?? d.sections.find((x) => x.section === '11.4.1')?.section ?? d.sections[0]?.section ?? null);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'The finished draft could not be loaded.');
    }
  }, []);

  const attach = useCallback(
    (run_id: string) => {
      setLive({ ...EMPTY_LIVE, runId: run_id, status: 'running' });
      unsub.current?.();
      unsub.current = subscribeRun(
        run_id,
        (e) => {
          setLive((s) => reduceEvent(s, e));
          if (e.type === 'run' && e.status === 'done') void finish(e.run_id);
          if (e.type === 'run' && e.status === 'error') {
            setRunError(e.error ?? 'The run stopped with an error.');
            unsub.current?.();
          }
        },
        () => setRunError('The connection to the run was lost. The last finished draft is still shown.'),
      );
    },
    [finish],
  );

  /* After a reload during a run, rejoin it: the server replays its events from the start. */
  useEffect(() => {
    void getActiveRun()
      .then((id) => {
        if (id) attach(id);
      })
      .catch(() => undefined);
  }, [attach]);

  async function run(sections?: string[]) {
    setRunError(null);
    setStarting(true);
    setCollapsed(false);
    try {
      const { run_id } = await startRun(sections);
      attach(run_id);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'The run could not start.');
    } finally {
      setStarting(false);
    }
  }

  const rows = useMemo<TreeRow[]>(() => {
    const status = (sec: string, own: TreeRow['status']): TreeRow['status'] => (live.status === 'running' ? (live.sections[sec] ?? 'planned') : own);
    if (doc) return [...doc.sections].sort((a, b) => a.ord - b.ord).map((s) => ({ section: s.section, title: s.title, ord: s.ord, agent: s.agent, status: status(s.section, s.status) }));
    return [...(registry.data ?? [])].sort((a, b) => a.ord - b.ord).map((s) => ({ section: s.section, title: s.title, ord: s.ord, agent: s.agent, status: live.sections[s.section] ?? 'planned' }));
  }, [doc, registry.data, live]);

  const sel = selected ?? doc?.sections.find((s) => s.section === '11.4.1')?.section ?? rows[0]?.section ?? null;
  const selSection = doc?.sections.find((s) => s.section === sel) ?? null;

  function select(section: string, flashIt = false) {
    setSelected(section);
    setFlash(flashIt ? section : null);
    const pane = docPane.current;
    const el = pane?.querySelector<HTMLElement>(`#sec-${CSS.escape(section)}`);
    if (pane && el) pane.scrollTo({ top: pane.scrollTop + el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12, behavior: 'smooth' });
  }

  /* Open the document at the primary endpoint, the section the story turns on. */
  const firstRun = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || firstRun.current === doc.run_id || !doc.sections.some((s) => s.section === '11.4.1')) return;
    firstRun.current = doc.run_id;
    const t = setTimeout(() => select('11.4.1'), 100);
    return () => clearTimeout(t);
  }, [doc]);

  function onPageScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!collapsed && e.currentTarget.scrollTop > 160) setCollapsed(true);
  }
  function showDocument() {
    setCollapsed(true);
    setTimeout(() => workspace.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }

  const facts = useMemo(() => {
    if (!doc) return null;
    const drafted = doc.sections.filter((s) => (s.kind === 'drafted' || s.kind === 'narrative') && s.status !== 'failed').length;
    const total = doc.sections.filter((s) => s.kind === 'drafted' || s.kind === 'narrative').length;
    const figures = doc.sections.reduce((n, s) => n + s.sentences.reduce((m, x) => m + x.parts.filter((p) => 'slot' in p).length, 0), 0);
    const passed = doc.document_checks.filter((c) => c.ok).length;
    return { drafted, total, figures, passed, checks: doc.document_checks.length };
  }, [doc]);

  const member = pod.data?.members.find((m) => m.id === drawer) ?? null;

  return (
    <div className="h-full overflow-y-auto" onScroll={onPageScroll}>
      <div className="mx-auto max-w-[1840px] space-y-4 px-6 py-5">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-ink">{STUDY} Clinical Study Report, draft</h1>
            {facts && doc ? (
              <p className="mt-1 text-[13px] text-ink-muted">
                Run time {formatDuration(doc.wall_ms)} &middot; {facts.drafted} of {facts.total} sections drafted &middot; {facts.figures} figures bound &middot; {facts.passed} of {facts.checks} document checks passed &middot; Table 14.2.1 v{doc.efficacy_version}
                <span className="ml-3">
                  <ConfigLink keys={['csr_trace', 'beat3_traces']} label="Run trace in MLflow" />
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-ink-muted">No run yet. The pod drafts the whole report from the certified tables and the parsed protocol and SAP.</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {doc ? (
              <Button asChild variant="outline">
                <a href={exportUrl(doc.run_id)}>
                  <Download className="mr-1.5 size-4" />
                  Export for Word
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Download className="mr-1.5 size-4" />
                Export for Word
              </Button>
            )}
            <Button disabled={running || !pod.data} onClick={() => void run()}>
              {running ? <LoaderCircle className="mr-1.5 size-4 animate-spin" /> : <Play className="mr-1.5 size-4" />}
              {running ? 'Drafting' : doc ? 'Draft the whole CSR again' : 'Draft the whole CSR'}
            </Button>
          </div>
        </header>

        {runError ? <ErrorNote title="The run did not finish" detail={runError} /> : null}

        {/* The pod */}
        {pod.loading ? (
          <PodSkeleton />
        ) : pod.error || !pod.data ? (
          <div className="space-y-2">
            <ErrorNote title="The pod could not be loaded" detail={pod.error} />
            <Button size="sm" variant="outline" onClick={pod.retry}>
              Try again
            </Button>
          </div>
        ) : collapsed ? (
          <PodStrip pod={pod.data} live={live} onExpand={() => setCollapsed(false)} />
        ) : (
          <section aria-label="The CSR Pod" className="border border-line bg-page px-5 py-4">
            <div className="mb-3 flex items-start gap-4">
              <p className="min-w-0 flex-1 text-[13.5px] text-ink">
                A pod is a <b className="font-semibold">team running a process</b>. Work flows left to right through handoffs. Each agent is a skill, its tools and the agents it calls, and each acts for a responsible department.
                <span className="text-ink-muted"> Select a card to read its skill and watch its tool calls.</span>
              </p>
              <Button size="sm" variant="outline" className="shrink-0" onClick={showDocument}>
                <ChevronUp className="mr-1 size-4" />
                Show document
              </Button>
            </div>
            <PodFlow pod={pod.data} live={live} doc={doc} selected={drawer} onPick={setDrawer} />
          </section>
        )}

        {/* The workspace */}
        <div ref={workspace} className="border border-line bg-page">
          {doc && doc.redelivery.length > 0 ? (
            <RedeliveryBanner
              items={doc.redelivery}
              onShow={(s) => {
                select(s, true);
              }}
            />
          ) : null}
          <div className="grid h-[calc(100vh-9rem)] min-h-[520px] grid-cols-[300px_minmax(0,1fr)_340px] min-[1700px]:grid-cols-[320px_minmax(0,1fr)_380px]">
            <div className="min-h-0 border-r border-line">
              {registry.loading && !doc ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="p-3">{registry.error ? <ErrorNote title="The section plan could not be loaded" detail={registry.error} /> : <EmptyNote title="No sections" hint="The section registry is empty." />}</div>
              ) : (
                <SectionTree rows={rows} selected={sel} onSelect={(s) => select(s)} />
              )}
            </div>
            <div ref={docPane} className="min-h-0 overflow-y-auto bg-desk px-6">
              {latest.loading && !doc ? (
                <div className="mx-auto max-w-[760px] space-y-3 py-6">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-64" />
                </div>
              ) : doc ? (
                <CsrDocumentView sections={[...doc.sections].sort((a, b) => a.ord - b.ord)} selected={sel} redelivery={doc.redelivery} flashSection={flash} />
              ) : (
                <div className="mx-auto max-w-[760px] py-6">
                  {registry.error ? <ErrorNote title="The section plan could not be loaded" detail={registry.error} /> : <PlanTable rows={[...(registry.data ?? [])].sort((a, b) => a.ord - b.ord)} live={live} />}
                </div>
              )}
            </div>
            <div className="min-h-0 border-l border-line bg-page">
              <SectionInspector sec={selSection} busy={running} onRedraft={(s) => void run([s])} />
            </div>
          </div>
        </div>

        {pod.data ? (
          <Accountability
            pod={pod.data}
            runId={runId}
            state={signoffs}
            onSign={async (department, decision) => {
              if (!runId) return;
              await postSignoff({ run_id: runId, department, decision });
              await refreshSignoffs(runId);
            }}
          />
        ) : null}
        <p className="pb-4 text-[11px] text-ink-muted">
          <FileText className="mr-1 inline size-3" aria-hidden="true" />
          Synthetic study. Figures come from certified tables in Unity Catalog; the model writes the text and never sees a figure value.
        </p>
      </div>

      {member ? <AgentDrawer member={member} live={live} doc={doc} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}

