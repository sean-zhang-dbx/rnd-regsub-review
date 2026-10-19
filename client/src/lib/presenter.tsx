import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

/*
 * Presenter mode: "See it in Databricks" links are hidden by default.
 * The `D` key or the switch in the header shows them on every beat.
 */
export const PRESENTER_KEY = 'd';

const PresenterContext = createContext<{ on: boolean; setOn: (v: boolean) => void }>({
  on: false,
  setOn: () => undefined,
});

export function PresenterProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== PRESENTER_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setOn((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ on, setOn }), [on]);
  return <PresenterContext.Provider value={value}>{children}</PresenterContext.Provider>;
}

export function usePresenter() {
  return useContext(PresenterContext);
}

/* config/demo-links.json is bundled at build time. A missing file or key yields no link. */
const linkFiles = import.meta.glob('../../../config/demo-links.json', { eager: true, import: 'default' });

function urlOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object') {
    const u: unknown = Object.entries(v).find(([k]) => k === 'url')?.[1];
    if (typeof u === 'string' && u) return u;
  }
  return null;
}

function readLinks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mod of Object.values(linkFiles)) {
    if (!mod || typeof mod !== 'object') continue;
    for (const [k, v] of Object.entries(mod)) {
      const url = urlOf(v);
      if (url) out[k] = url;
    }
  }
  return out;
}

const LINKS = readLinks();

export function linkFor(key: string): string | null {
  return LINKS[key] ?? null;
}

/** The one link style used on every beat. */
export function DbxLink({ linkKey, label, className = '' }: { linkKey: string; label: string; className?: string }) {
  const { on } = usePresenter();
  const href = linkFor(linkKey);
  if (!on || !href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-sans text-xs text-muted-foreground underline underline-offset-4 decoration-border hover:text-cited hover:decoration-cited ${className}`}
    >
      {label}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}
