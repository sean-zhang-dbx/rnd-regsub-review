import { createBrowserRouter, RouterProvider } from 'react-router';
import { Shell } from './components/Shell';
import { ScorecardProvider } from './hooks/scorecard';
import { Compare } from './screens/Compare';
import { Pod } from './screens/Pod';
import { Redelivery } from './screens/Redelivery';
import { Scorecard } from './screens/Scorecard';
import { Sources } from './screens/Sources';
import { XRayProvider } from './xray/XRay';

function Root() {
  return (
    <ScorecardProvider>
      <XRayProvider>
        <Shell />
      </XRayProvider>
    </ScorecardProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Scorecard /> },
      { path: '/sources', element: <Sources /> },
      { path: '/pod', element: <Pod /> },
      { path: '/compare', element: <Compare /> },
      { path: '/redelivery', element: <Redelivery /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
