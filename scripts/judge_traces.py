"""Score the wording_check traces in the MLflow experiment with a code check and an LLM judge.

    uv run --python 3.12 --with "mlflow[databricks]>=3.5" --with databricks-sql-connector python scripts/judge_traces.py

Run it after a rehearsal (and again after the call). Each wording_check trace gets 2 assessments,
visible as columns on the experiment's Traces tab, and the run is logged as an MLflow evaluation:
- figures_match_source (code): every changed figure in the updated sentence equals the current
  cell of Table 14.2.1 (efficacy_primary), so no number came from the model.
- verdict_supported (LLM judge, a different model family from the checker): the checker's verdict
  follows from the sentence before and after the restatement.
Each draft_section trace gets 1 assessment:
- figures_bound_to_cells (code): the drafting model wrote every figure as a placeholder, so SQL filled
  all of them from Table 14.2.1 and the model typed none.
"""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

os.environ["DATABRICKS_HOST"] = dbx.HOST
os.environ["DATABRICKS_TOKEN"] = dbx.token()

import mlflow  # noqa: E402
from mlflow.entities import Feedback  # noqa: E402
from mlflow.genai.judges import make_judge  # noqa: E402
from mlflow.genai.scorers import scorer  # noqa: E402

EXPERIMENT_ID = "1752849192687853"
JUDGE_MODEL = "databricks:/databricks-gpt-5-5"

mlflow.set_tracking_uri("databricks")
mlflow.set_experiment(experiment_id=EXPERIMENT_ID)

# Current values of the cited efficacy cells, read from the certified table (same SQL as the app).
q = dbx.runner()
CURRENT = {
    r["fig_key"]: r["value"]
    for r in q(f"""
    WITH curr AS (
      SELECT row_key, stack(6,
        'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
        'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
        'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
      ) AS (column_name, value_text)
      FROM {dbx.FQ}.efficacy_primary)
    SELECT c.fig_key, curr.value_text AS value
    FROM (SELECT DISTINCT fig_key, row_key, column_name FROM {dbx.FQ}.figure_citations
          WHERE source_table = 'efficacy_primary') c
    JOIN curr ON c.row_key = curr.row_key AND c.column_name = curr.column_name""")
}
VERSION = q(f"DESCRIBE HISTORY {dbx.FQ}.efficacy_primary LIMIT 1")[0]["version"]


def _parts(prompt: str):
    """Split the checker prompt into (updated sentence, [(fig_key, old, new)])."""
    updated = re.search(r"Sentence with the updated figures:\n(.*?)\n\nChanged figures:", prompt, re.S)
    changes = re.findall(r"^(\w+): (\S+) -> (\S+)$", prompt, re.M)
    return (updated.group(1) if updated else ""), changes


@scorer
def figures_match_source(inputs):
    sentence, changes = _parts(inputs.get("prompt", ""))
    if not changes:
        return Feedback(value=True, rationale="No figure in this sentence changed in the restatement.")
    wrong = [
        f"{key} is {new} in the text but {CURRENT.get(key)} in the table"
        for key, _old, new in changes
        if CURRENT.get(key) != new or new not in sentence
    ]
    if wrong:
        return Feedback(value=False, rationale="; ".join(wrong) + ".")
    shown = ", ".join(f"{key} {new}" for key, _old, new in changes)
    return Feedback(
        value=True,
        rationale=f"All {len(changes)} changed figures ({shown}) equal Table 14.2.1 (efficacy_primary) version {VERSION}.",
    )


verdict_supported = make_judge(
    name="verdict_supported",
    instructions=(
        "You review the output of a wording checker used in regulatory medical writing. A certified "
        "analysis table was restated and the figures in a sentence were replaced from the table. The "
        "checker had to decide whether the wording around the new figures still holds.\n\n"
        "The checker's input (the sentence before and after, and the changed figures): {{ inputs }}\n"
        "The checker's output (verdict and reason): {{ outputs }}\n\n"
        "The verdict should be needs_writer when the sentence uses a qualitative or fractional expression "
        "(such as two-thirds, half, majority, more than) and the new figure is now on the other side of the "
        "value that expression names. Otherwise it should be ok. The reason must name the right figure "
        "and expression and must not rewrite the sentence.\n\n"
        "Answer yes if the verdict and reason are correct, or no if they are not."
    ),
    feedback_value_type=bool,
    model=JUDGE_MODEL,
)

@scorer
def figures_bound_to_cells(outputs):
    typed = (outputs or {}).get("typed_numbers") or []
    unknown = (outputs or {}).get("unknown_slots") or []
    count = (outputs or {}).get("figure_count", 0)
    if typed or unknown:
        parts = []
        if typed:
            parts.append(f"the model typed {', '.join(typed)} itself")
        if unknown:
            parts.append(f"unknown placeholders {', '.join(unknown)}")
        return Feedback(value=False, rationale="; ".join(parts).capitalize() + ".")
    return Feedback(value=True, rationale=f"All {count} figures are placeholders filled from Table 14.2.1 by SQL.")


all_traces = mlflow.search_traces(experiment_ids=[EXPERIMENT_ID], max_results=500)


def unscored(span_name: str, assessment: str):
    names = {span_name, "draft_run"} if span_name == "draft_section" else {span_name}
    t = all_traces[all_traces["spans"].map(lambda spans: any(s.get("name") in names and not s.get("parent_span_id") for s in spans or []))]
    done = t["assessments"].map(lambda a: any(x.get("assessment_name") == assessment for x in a or []))
    print(f"{span_name} traces: {len(t)}, not yet scored: {int((~done).sum())}")
    return t[~done]


jobs = [
    ("wording_check", unscored("wording_check", "verdict_supported"), [figures_match_source, verdict_supported]),
    ("drafting", unscored("draft_section", "figures_bound_to_cells"), [figures_bound_to_cells]),
]
if all(t.empty for _, t, _ in jobs):
    sys.exit("Nothing new to score. Run a wording check or a draft in the app first.")

for name, t, scorers in jobs:
    if t.empty:
        continue
    with mlflow.start_run(run_name=f"{name} judges, Table 14.2.1 v{VERSION}"):
        results = mlflow.genai.evaluate(data=t, scorers=scorers)
    print(name, "run:", results.run_id)
    for k, v in sorted(results.metrics.items()):
        print(f"  {k}: {v}")
