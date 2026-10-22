import { NavLink, Outlet } from 'react-router';
import { Switch } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { formatDuration } from '../lib/format';
import { useScorecard } from '../hooks/scorecard';
import { useXRay } from '../xray/XRay';

const STOPS = [
  { to: '/', label: 'Scorecard', end: true },
  { to: '/sources', label: 'Sources' },
  { to: '/pod', label: 'Pod' },
  { to: '/compare', label: 'Compare' },
  { to: '/redelivery', label: 'Re-delivery and sign-off' },
];

export function Shell() {
  const sc = useScorecard();
  const { on, toggle } = useXRay();
  const wall = sc.data?.headline.wall_ms;
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto]">
      <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[14px]">
          <span className="num font-medium">CDISCPILOT01</span>
          <span className="ml-3 text-muted-foreground">Xanomeline TTS in mild to moderate Alzheimer&apos;s disease</span>
        </p>
        {wall ? <p className="text-[14px] text-muted-foreground">run {formatDuration(wall)}</p> : null}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={on} onCheckedChange={toggle} aria-label="Show Databricks objects" />
          <span>
            Databricks objects <kbd className="num rounded-control border border-border px-1 text-[11px]">X</kbd>
          </span>
        </label>
      </header>

      <div className="grid min-h-0 grid-cols-[216px_1fr]">
        <nav aria-label="Demo steps" className="border-r border-border py-5">
          <ul>
            {STOPS.map((s) => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  end={s.end}
                  className={({ isActive }) =>
                    cn(
                      'block border-l-[3px] py-2 pr-3 pl-5 text-[15px] leading-snug transition-colors',
                      isActive ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-h-0 overflow-y-auto px-8 py-7">
          <Outlet />
        </main>
      </div>

      <footer className="border-t border-border bg-card px-6 py-2 text-[12px] text-muted-foreground">
        Data: CDISC SDTM/ADaM Pilot Project (CDISCPILOT01), used under the CDISC terms of use. The drafted report is produced by this demo; the submitted report is shown for comparison.
      </footer>
    </div>
  );
}
