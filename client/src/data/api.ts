/*
 * Server routes from docs/DEMO_PLAN.md section 4. Fixtures stand in until the routes exist.
 * Replace each body with `postJson('/api/...', body)` when switching.
 */
import { genieAnswer, untrackedHits, wordingChecks, writeSignoff } from '../fixtures/data';
import { fixtureRoute } from '../fixtures/runtime';
import type { GenieAnswer, SignoffAction, SignoffResponse, UntrackedHit, WordingCheckResult } from './types';

export function postWordingCheck(sentenceIds: string[]): Promise<WordingCheckResult[]> {
  return fixtureRoute(wordingChecks(sentenceIds), 2400);
}

export function postSearchUntracked(_oldValues: string[]): Promise<UntrackedHit[]> {
  return fixtureRoute(untrackedHits, 700);
}

export function postSignoff(sentenceIds: string[], action: SignoffAction): Promise<SignoffResponse> {
  return fixtureRoute(writeSignoff(sentenceIds, action), 500);
}

export function postGenieAsk(_question: string): Promise<GenieAnswer> {
  return fixtureRoute(genieAnswer, 1800);
}
