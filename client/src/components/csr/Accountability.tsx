import { useState } from 'react';
import { Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { Button } from '@databricks/appkit-ui/react';
import type { CsrSignoff, PodDef, SignoffState } from '../../data/csr';
import { formatSignedAt } from '../../lib/format';
import { cn } from '../../lib/utils';
import { ConfigLink } from './SectionInspector';

const REG = 'Regulatory Affairs';

function versionsOf(s: CsrSignoff): string {
  let v: Record<string, number> | undefined = s.table_versions;
  if (!v && s.table_versions_json) {
    try {
      v = JSON.parse(s.table_versions_json) as Record<string, number>;
    } catch {
      v = undefined;
    }
  }
  if (!v) return '';
  return Object.entries(v)
    .map(([t, n]) => `${t.replace(/^.*\./, '').replace(/^tlf_/, '')} v${n}`)
    .join(', ');
}

export function Accountability({
  pod,
  runId,
  state,
  onSign,
}: {
  pod: PodDef;
  runId: string | null;
  state: SignoffState | null;
  onSign: (department: string, decision: 'approved' | 'changes_requested') => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = (dept: string) => state?.signoffs.filter((s) => s.department === dept).sort((a, b) => a.signed_at.localeCompare(b.signed_at)).at(-1);
  const others = pod.departments.filter((d) => d.department !== REG);
  const pending = others.filter((d) => latest(d.department)?.decision !== 'approved').length;

  async function act(dept: string, decision: 'approved' | 'changes_requested') {
    setBusy(dept);
    setErr(null);
    try {
      await onSign(dept, decision);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The sign-off was not saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="acct-h" className="border border-line bg-page">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <ShieldCheck className="size-4 text-attention" aria-hidden="true" />
        <h2 id="acct-h" className="text-[15px] font-semibold text-ink">
          Accountability &amp; sign-off
        </h2>
        <span className="text-xs text-ink-muted">Nothing is released until the responsible people sign.</span>
        <span className="ml-auto flex gap-4">
          <ConfigLink keys={['csr_signoffs', 'beat4_signoffs']} label="Sign-offs table in Databricks" />
          <ConfigLink keys={['csr_genie', 'beat4_genie']} label="Genie Agent in Databricks" />
        </span>
      </header>
      {err ? <p role="alert" className="border-b border-attention/30 bg-attention-soft px-5 py-2 text-sm text-ink">{err}</p> : null}
      <ul className="divide-y divide-line">
        {pod.departments.map((d) => {
          const s = latest(d.department);
          const isReg = d.department === REG;
          const blocked = isReg && pending > 0;
          const approved = s?.decision === 'approved';
          return (
            <li key={d.department} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink">{d.scope}</div>
                <div className="text-[12.5px] text-ink-muted">
                  Accountable: {d.department} &middot; signed by {d.signer}, {d.role}
                </div>
                {s ? (
                  <div className={cn('mt-0.5 text-[12px]', approved ? 'text-recomputed' : 'text-attention')}>
                    {approved ? 'Approved' : 'Changes requested'} {formatSignedAt(s.signed_at)}
                    {versionsOf(s) ? `, signed against ${versionsOf(s)}` : ''}
                    {s.note ? `. ${s.note}` : ''}
                  </div>
                ) : blocked ? (
                  <div className="mt-0.5 text-[12px] text-attention">
                    Release blocked until {pending} {pending === 1 ? 'department signs' : 'departments sign'}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[12px] text-ink-muted">Waiting for {d.signer}</div>
                )}
              </div>
              <span className="shrink-0 rounded-[3px] bg-open-soft px-2 py-0.5 text-[11px] font-medium text-ink-muted">Named approver</span>
              <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-[3px] px-2 py-0.5 text-[11px] font-medium', approved ? 'bg-recomputed-soft text-recomputed' : 'bg-gate-soft text-attention')}>
                {approved ? <LockOpen className="size-3" aria-hidden="true" /> : <Lock className="size-3" aria-hidden="true" />}
                {approved ? 'Signed' : 'Locked'}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" disabled={!runId || blocked || busy === d.department || approved} onClick={() => void act(d.department, 'approved')}>
                  Sign
                </Button>
                <Button size="sm" variant="outline" disabled={!runId || busy === d.department} onClick={() => void act(d.department, 'changes_requested')}>
                  Request changes
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
