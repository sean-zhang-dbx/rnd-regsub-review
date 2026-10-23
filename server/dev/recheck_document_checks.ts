/*
 * Recompute the deterministic document checks (no model calls) of a stored run and compare them with the stored ones.
 *
 *   npx tsx --tsconfig tsconfig.server.json --env-file=.env server/dev/recheck_document_checks.ts <run_id> [--write]
 *
 * With --write the stored document_checks_json is replaced by the recomputed checks. Only do that when the other checks
 * come out identical (they are code over the stored text), which this script reports.
 */
import { ServiceContext } from '@databricks/appkit';
import { FQ, sqlRows } from '../lib/dbx';
import { documentChecks } from '../lib/pod/assemble';
import { certifiedTables, loadRegistry } from '../lib/pod/data';
import { loadDocument } from '../lib/pod/run';

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error('usage: recheck_document_checks.ts <run_id> [--write]');
  await ServiceContext.initialize();
  const [doc, registry, certified, narrative] = await Promise.all([
    loadDocument(runId),
    loadRegistry(),
    certifiedTables(),
    sqlRows(`SELECT row_key FROM ${FQ}.narrative_patients`),
  ]);
  if (!doc) throw new Error(`no such run ${runId}`);
  const tlfNumbers = new Set(certified.map((c) => c.tlf.replace('Table ', '')).filter(Boolean));
  const ord = new Map(registry.map((r) => [r.section, r.ord]));
  const sorted = [...doc.sections].sort((a, b) => (ord.get(a.section) ?? a.ord) - (ord.get(b.section) ?? b.ord));
  const fresh = documentChecks(sorted, registry, tlfNumbers, narrative.length);
  for (const c of fresh) {
    const old = doc.document_checks.find((x) => x.id === c.id);
    const same = old && old.ok === c.ok && old.detail === c.detail;
    console.log(`${same ? 'same   ' : 'CHANGED'} ${c.ok ? 'pass' : 'FAIL'} ${c.id}: ${c.detail}${same ? '' : `   (stored: ${old ? `${old.ok ? 'pass' : 'FAIL'} ${old.detail}` : 'absent'})`}`);
  }
  if (process.argv.includes('--write')) {
    await sqlRows(`UPDATE ${FQ}.csr_runs SET document_checks_json = :dc WHERE run_id = :r`, [
      { name: 'dc', value: JSON.stringify(fresh) },
      { name: 'r', value: runId },
    ]);
    console.log('stored document_checks_json updated');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
