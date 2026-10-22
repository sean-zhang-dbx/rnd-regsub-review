import { createContext, useContext, type ReactNode } from 'react';
import { getScorecard } from '../data/api';
import type { Scorecard } from '../data/types';
import { useAsync, type AsyncState } from './useAsync';

/* One scorecard for the shell (run time), the Scorecard screen, and the re-delivery screen. */
const Ctx = createContext<AsyncState<Scorecard> | null>(null);

export function ScorecardProvider({ children }: { children: ReactNode }) {
  const state = useAsync(getScorecard);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useScorecard(): AsyncState<Scorecard> {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScorecard needs ScorecardProvider');
  return v;
}
