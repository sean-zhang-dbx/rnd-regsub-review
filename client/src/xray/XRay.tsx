import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { linkFor } from './links';
import { XRAY } from './objects';

/*
 * X-ray layer. Off by default. The X key (or the switch in the top line) shows one quiet marker per part
 * of the screen that has a Databricks object behind it. A marker opens the drawer, which always has the
 * same layout: object, status, code, and the link.
 */
type Ctx = { on: boolean; toggle: () => void; open: string | null; setOpen: (id: string | null) => void };
const XRayCtx = createContext<Ctx>({ on: false, toggle: () => undefined, open: null, setOpen: () => undefined });
export const useXRay = () => useContext(XRayCtx);

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function XRayProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) setOn((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo<Ctx>(() => ({ on, toggle: () => setOn((v) => !v), open, setOpen }), [on, open]);
  return (
    <XRayCtx.Provider value={value}>
      {children}
      <XRayDrawer />
    </XRayCtx.Provider>
  );
}

/** Place inside a `relative` parent. Renders nothing while the layer is off. */
export function XRayMarker({ id, className }: { id: string; className?: string }) {
  const { on, setOpen } = useXRay();
  const entry = XRAY[id];
  if (!on || !entry) return null;
  return (
    <button
      type="button"
      data-xray-marker={id}
      onClick={() => setOpen(id)}
      aria-label={`Show the Databricks object behind ${entry.area}`}
      title={entry.area}
      className={cn(
        'absolute top-2 right-2 z-20 flex size-[22px] items-center justify-center rounded-full border border-primary/60 bg-card text-primary transition-colors hover:bg-primary hover:text-primary-foreground',
        className,
      )}
    >
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function XRayDrawer() {
  const { open, setOpen } = useXRay();
  const entry = open ? XRAY[open] : null;
  const href = entry ? linkFor(entry.linkKey) : null;
  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && setOpen(null)}>
      <SheetContent side="right" className="w-[500px] gap-0 border-xray-line bg-xray text-xray-foreground sm:max-w-[500px] [&>button]:text-xray-foreground">
        {entry ? (
          <>
            <SheetHeader className="border-b border-xray-line p-5">
              <p className="text-[13px] text-xray-muted">{entry.area}</p>
              <SheetTitle className="text-[18px] font-semibold text-xray-foreground">What is behind this</SheetTitle>
              <SheetDescription className="sr-only">Databricks objects behind {entry.area}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <section>
                <h3 className="mb-1.5 text-[13px] font-medium text-xray-muted">Object</h3>
                <ul className="space-y-1">
                  {entry.objects.map((o) => (
                    <li key={o} className="num break-all text-[13px]">
                      {o}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="mb-1.5 text-[13px] font-medium text-xray-muted">Status</h3>
                <p className="text-[14px]">{entry.status}</p>
              </section>
              <p className="text-[14px] leading-relaxed">{entry.text}</p>
              {entry.code ? (
                <section>
                  <h3 className="mb-1.5 text-[13px] font-medium text-xray-muted">{entry.code.label}</h3>
                  <pre className="num overflow-x-auto rounded-control border border-xray-line p-3 text-[12px] leading-relaxed whitespace-pre-wrap">{entry.code.body}</pre>
                </section>
              ) : null}
            </div>
            <footer className="border-t border-xray-line p-5">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-control bg-xray-foreground px-3.5 py-2 text-[14px] font-medium text-xray hover:opacity-90"
                >
                  See it in Databricks
                </a>
              ) : (
                <p className="text-[13px] text-xray-muted">The link for {entry.linkLabel} is not available yet.</p>
              )}
            </footer>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
