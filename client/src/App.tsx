import { useState } from 'react';
import type { FormEvent } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useNavigate, useParams } from 'react-router';
import { Kbd, Label, Switch } from '@databricks/appkit-ui/react';
import { Search } from 'lucide-react';
import { Overview } from './pages/Overview';
import { Viewer } from './pages/Viewer';
import { REVIEWER_SHORT, STUDY } from './lib/format';
import { ReviewProvider, useReview } from './data/review';
import { PRESENTER_KEY, PresenterProvider, usePresenter } from './lib/presenter';

function PresenterSwitch() {
  const { on, setOn } = usePresenter();
  return (
    <div className="flex items-center gap-2">
      <Switch id="presenter" checked={on} onCheckedChange={setOn} className="data-[state=unchecked]:bg-white/25" />
      <Label htmlFor="presenter" className="text-sm text-bar-muted">
        Databricks
      </Label>
      <Kbd className="bg-white/10 text-bar-muted">{PRESENTER_KEY.toUpperCase()}</Kbd>
    </div>
  );
}

/* The search box runs AI Search over the reference documents, shown on the QC log. */
function DossierSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    void navigate(t ? `/?q=${encodeURIComponent(t)}#reference` : '/#reference');
  }
  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-bar-muted" aria-hidden="true" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the dossier and reference documents"
        aria-label="Search the dossier and reference documents"
        className="h-9 w-full rounded-[var(--radius)] border border-white/15 bg-white/10 pr-3 pl-9 text-sm text-page placeholder:text-bar-muted focus:bg-white/15 focus:outline-none"
      />
    </form>
  );
}

function ProductMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect x="5" y="3" width="13" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <rect x="8" y="6" width="13" height="16" rx="1.5" fill="currentColor" />
      <path d="M11 12.5l2 2 4-4.5" fill="none" stroke="var(--bar)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Layout() {
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-8 bg-bar px-5 text-page">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <ProductMark />
          <span className="text-[17px] font-semibold tracking-tight">Dossier Review</span>
        </Link>
        <div className="flex flex-1 justify-center">
          <DossierSearch />
        </div>
        <div className="flex shrink-0 items-center gap-6">
          <div className="text-sm">
            <span className="text-bar-muted">Study </span>
            <span className="font-medium">{STUDY}</span>
          </div>
          <PresenterSwitch />
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-white/15 text-xs font-semibold">AO</span>
            <span className="text-sm">{REVIEWER_SHORT}</span>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

/* Older links by section open the first finding in that section. */
function SectionRedirect() {
  const { section } = useParams();
  const review = useReview();
  if (review.impact.loading) return null;
  const first = review.affected.find((r) => r.section === section) ?? review.affected[0];
  return <Navigate to={first ? `/review/${first.sentence_id}` : '/'} replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/review/:sentenceId', element: <Viewer /> },
      { path: '/section/:section', element: <SectionRedirect /> },
    ],
  },
]);

export default function App() {
  return (
    <PresenterProvider>
      <ReviewProvider>
        <RouterProvider router={router} />
      </ReviewProvider>
    </PresenterProvider>
  );
}
