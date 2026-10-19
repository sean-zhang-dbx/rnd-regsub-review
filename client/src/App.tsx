import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router';
import { Kbd, Label, Switch } from '@databricks/appkit-ui/react';
import { Overview } from './pages/Overview';
import { Section } from './pages/Section';
import { REVIEWER_SHORT, STUDY } from './lib/format';
import { ReviewProvider } from './data/review';
import { PRESENTER_KEY, PresenterProvider, usePresenter } from './lib/presenter';

function PresenterSwitch() {
  const { on, setOn } = usePresenter();
  return (
    <div className="flex items-center gap-2">
      <Switch id="presenter" checked={on} onCheckedChange={setOn} />
      <Label htmlFor="presenter" className="text-sm text-ink-muted">
        Databricks
      </Label>
      <Kbd>{PRESENTER_KEY.toUpperCase()}</Kbd>
    </div>
  );
}

function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-page px-6 py-3 md:px-10">
        <Link to="/" className="text-sm font-semibold text-ink">
          {STUDY} <span className="ml-1 font-normal text-ink-muted">Submission review</span>
        </Link>
        <div className="flex items-center gap-6">
          <PresenterSwitch />
          <span className="text-sm text-ink">{REVIEWER_SHORT}</span>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/section/:section', element: <Section /> },
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
