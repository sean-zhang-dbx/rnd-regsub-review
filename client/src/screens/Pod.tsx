import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import { AgentDrawer } from '../components/pod/AgentDrawer';
import { EMPTY_LIVE, reduceEvent } from '../components/pod/model';
import type { RunLive } from '../components/pod/model';
import { PodFlow } from '../components/pod/PodFlow';
import { getLatestRun, getPod, subscribeRun } from '../data/api';
import type { AgentId } from '../data/types';
import { useAsync } from '../hooks/useAsync';
import { XRayMarker } from '../xray/XRay';

export function Pod() {
  const pod = useAsync(getPod);
  const latest = useAsync(getLatestRun);
  const [live, setLive] = useState<RunLive>(EMPTY_LIVE);
  const [note, setNote] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<AgentId | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  useEffect(() => () => unsub.current?.(), []);

  const replay = useCallback(() => {
    const id = latest.data?.run_id;
    if (!id) return;
    setNote(null);
    setLive({ ...EMPTY_LIVE, runId: id, status: 'running' });
    unsub.current?.();
    unsub.current = subscribeRun(
      id,
      (e) => {
        setLive((s) => reduceEvent(s, e));
        if (e.type === 'run' && e.status !== 'running') unsub.current?.();
      },
      () => {
        setLive(EMPTY_LIVE);
        setNote('The replay is not available. The stored run is shown.');
      },
    );
  }, [latest.data?.run_id]);

  const running = live.status === 'running';
  const member = pod.data?.members.find((m) => m.id === drawer) ?? null;

  return (
    <div className="w-full max-w-[1760px]">
      <div className="flex items-end gap-4">
        <h1 className="flex-1 text-[26px] leading-tight font-semibold tracking-[-0.01em]">Open an agent to see the tool calls it made and the passages it chose for this draft.</h1>
        <Button className="rounded-control" disabled={running || !latest.data} onClick={replay}>
          {running ? 'Replaying' : 'Replay the run'}
        </Button>
      </div>
      {note ? <p className="mt-2 text-[13px] text-muted-foreground">{note}</p> : null}
      {live.status === 'error' ? <p role="alert" className="mt-2 text-[13px] text-differs">{live.error ?? 'The run stopped with an error.'}</p> : null}
      <Panel className="mt-6 p-5">
        <XRayMarker id="pod" />
        <XRayMarker id="pod_agents" className="right-[124px]" />
        {pod.loading || latest.loading ? (
          <LoadingBlock rows={6} />
        ) : pod.error || !pod.data ? (
          <ErrorBlock title="The pod could not be loaded" detail={pod.error} onRetry={pod.retry} />
        ) : latest.error ? (
          <ErrorBlock title="The finished run could not be loaded" detail={latest.error} onRetry={latest.retry} />
        ) : !latest.data ? (
          <EmptyBlock title="No finished run yet">Start a run on the server, then reload this screen.</EmptyBlock>
        ) : (
          <PodFlow pod={pod.data} live={live} doc={latest.data} selected={drawer} onPick={setDrawer} />
        )}
      </Panel>
      <AgentDrawer member={member} live={live} doc={latest.data} onClose={() => setDrawer(null)} />
    </div>
  );
}
