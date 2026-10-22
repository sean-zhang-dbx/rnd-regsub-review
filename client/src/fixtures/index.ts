import type { CsrSignoff, PodEvent, Redelivery, SignoffState } from '../data/types';
import { compareFixtureFor } from './compare';
import { csrDocFixture, podFixture, redraftEvents, replayEvents } from './pod';
import { scorecardFixture } from './scorecard';
import { sourcesFixture } from './sources';

/* FIXTURE state that the real server keeps in tables: whether the re-delivery ran, and the sign-offs. */
const state = { redelivered: false, active: false, signoffs: [] as CsrSignoff[] };
const wait = <T>(v: T, ms = 350) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export const fx = {
  scorecard: () => wait(scorecardFixture(state.redelivered)),
  sources: () => wait(sourcesFixture),
  pod: () => wait(podFixture),
  latestRun: () => wait(csrDocFixture),
  compare: (section: string) => wait(compareFixtureFor(section), 500),
  active: () => wait({ run_id: state.active ? 'fixture-redraft' : null }, 50),
  signoffs: () => {
    const approved = new Set(state.signoffs.filter((s) => s.decision === 'approved').map((s) => s.department));
    const pending = ['Medical Writing', 'Biostatistics', 'Clinical Safety'].filter((d) => !approved.has(d));
    return wait<SignoffState>({ signoffs: state.signoffs, release_blocked_by: pending }, 150);
  },
  signoff: async (department: string, decision: 'approved' | 'changes_requested') => {
    const d = podFixture.departments.find((x) => x.department === department);
    if (department === 'Regulatory Affairs' && decision === 'approved') {
      const open = ['Medical Writing', 'Biostatistics', 'Clinical Safety'].some((n) => !state.signoffs.some((s) => s.department === n && s.decision === 'approved'));
      if (open) throw new Error('Regulatory Affairs can sign after Medical Writing, Biostatistics and Clinical Safety have approved this run.');
    }
    state.signoffs.push({
      signoff_id: `fixture-${state.signoffs.length + 1}`,
      run_id: 'fixture-run-0001',
      department,
      scope: d?.scope ?? '',
      signer: d?.signer ?? '',
      role: d?.role ?? '',
      decision,
      table_versions: { tlf_14_5_01_teae: state.redelivered ? 2 : 1, tlf_14_3_01_adascog_w24: 1 },
      signed_at: new Date().toISOString(),
    });
    await wait(null, 150);
  },
  redeliver: async (): Promise<Redelivery> => {
    state.active = true;
    await wait(null, 900);
    return {
      old_version: 1,
      new_version: 2,
      changed_cells: 9,
      affected: [
        { section: '12.2', sentence_idx: 1, slot: 'any_ae_pbo', old_value: '85', new_value: '79' },
        { section: '12.2', sentence_idx: 1, slot: 'any_ae_high', old_value: '90', new_value: '84' },
        { section: '12.2', sentence_idx: 2, slot: 'pt_nausea_high', old_value: '14', new_value: '11' },
        { section: '12.2', sentence_idx: 3, slot: 'pt_rash_low', old_value: '22', new_value: '19' },
        { section: '12.2', sentence_idx: 4, slot: 'pt_dizzy_high', old_value: '16', new_value: '13' },
        { section: '12.2', sentence_idx: 5, slot: 'soc_skin_high', old_value: '51', new_value: '46' },
        { section: '12.2', sentence_idx: 5, slot: 'soc_gi_high', old_value: '33', new_value: '28' },
      ],
      run_id: 'fixture-redraft',
    };
  },
  finishRedeliver: () => {
    state.redelivered = true;
    state.active = false;
  },
  reset: () => {
    state.redelivered = false;
    state.active = false;
    state.signoffs = [];
  },
  /* Plays a scripted event list at 450 ms per event; returns the unsubscribe function. */
  stream: (events: PodEvent[], onEvent: (e: PodEvent) => void, onDone?: () => void): (() => void) => {
    let i = 0;
    const timer = setInterval(() => {
      const e = events[i++];
      if (!e) {
        clearInterval(timer);
        onDone?.();
        return;
      }
      onEvent(e);
    }, 450);
    return () => clearInterval(timer);
  },
  replayEvents,
  redraftEvents,
};
