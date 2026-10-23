import { useEffect, useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import type { CsrSignoff, PodDef, SignoffState } from '../../data/types';
import { formatSignedAt, parseVersions, plural } from '../../lib/format';
import { Panel } from '../States';
import { XRayMarker } from '../../xray/XRay';

const REG = 'Regulatory Affairs';

/* Ported from rnd_regsub_review: one row per department, a sign button each, Regulatory Affairs last. */
export function Accountability({
  pod,
  runId,
  state,
  exportHref,
  onSign,
}: {
  pod: PodDef;
  runId: string | null;
  state: SignoffState | null;
  exportHref?: string;
  onSign: (department: string, decision: 'approved' | 'changes_requested') => Promise<void>;
}) {
  const [busy, setBusy] = useState<{ dept: string; decision: 'approved' | 'changes_requested'; count: number } | null>(null);
  /* The row says "Signing" from the click until the refreshed sign-offs arrive (or 8 s pass), not only while the POST is in flight. */
  const count = state?.signoffs.length ?? 0;
  const signing = busy && count <= busy.count ? busy : null;
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(null), 8000);
    return () => clearTimeout(t);
  }, [busy]);
  const [err, setErr] = useState<string | null>(null);
  const latest = (dept: string): CsrSignoff | undefined => state?.signoffs.filter((s) => s.department === dept).sort((a, b) => a.signed_at.localeCompare(b.signed_at)).at(-1);
  const pending = pod.departments.filter((d) => d.department !== REG && latest(d.department)?.decision !== 'approved').length;

  async function act(dept: string, decision: 'approved' | 'changes_requested') {
    setBusy({ dept, decision, count });
    setErr(null);
    try {
      await onSign(dept, decision);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The sign-off was not saved.');
      setBusy(null);
    }
  }

  return (
    <Panel>
      <XRayMarker id="signoff" />
      <header className="flex items-baseline gap-4 border-b border-border px-5 py-3 pr-12">
        <h2 className="text-[18px] font-semibold">Sign-off</h2>
        <p className="text-[13px] text-muted-foreground">Nothing is released until the responsible people sign.</p>
        {exportHref ? (
          <a href={exportHref} className="ml-auto text-[13px] font-medium text-primary underline underline-offset-4">
            Export for Word
          </a>
        ) : null}
      </header>
      {err ? (
        <p role="alert" className="border-b border-differs/30 bg-differs/[0.06] px-5 py-2 text-[14px] text-differs">
          {err}
        </p>
      ) : null}
      <ul className="divide-y divide-border/70">
        {pod.departments.map((d) => {
          const s = latest(d.department);
          const blocked = d.department === REG && pending > 0;
          const approved = s?.decision === 'approved';
          const v = s ? parseVersions(s.table_versions_json, s.table_versions) : '';
          return (
            <li key={d.department} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{d.scope}</p>
                <p className="text-[13px] text-muted-foreground">
                  {d.department}, {d.signer}, {d.role}
                </p>
                {signing?.dept === d.department ? (
                  <p role="status" className="mt-0.5 text-[13px] text-muted-foreground">
                    {signing.decision === 'approved' ? 'Signing' : 'Saving the request'}
                  </p>
                ) : s ? (
                  <p className={cn('mt-0.5 text-[13px]', approved ? 'text-match' : 'text-differs')}>
                    {approved ? 'Approved' : 'Changes requested'} {formatSignedAt(s.signed_at)}
                    {v ? `, signed against ${v}` : ''}
                    {s.note ? `. ${s.note}` : ''}
                  </p>
                ) : blocked ? (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Release waits for {plural(pending, 'department', 'departments')}</p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Waiting for {d.signer}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="rounded-control" disabled={!runId || blocked || signing?.dept === d.department || approved} onClick={() => void act(d.department, 'approved')}>
                  {d.department === REG ? 'Release' : 'Sign'}
                </Button>
                <Button size="sm" variant="outline" className="rounded-control" disabled={!runId || signing?.dept === d.department} onClick={() => void act(d.department, 'changes_requested')}>
                  Request changes
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
