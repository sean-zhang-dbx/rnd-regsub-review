"""Create (or recreate) the Genie Agent "Regsub Review: LMN-301 certified tables".

    python3 scripts/create_genie.py

Prints the space id. Uses the databricks CLI with profile fe-vm-sean-zhang.
"""
import json
import subprocess
import uuid

PROFILE = "fe-vm-sean-zhang"
WAREHOUSE = "16ad82bead3f55b5"
FQ = "sean_zhang_catalog.rnd_regsub_review"
TITLE = "Regsub Review: LMN-301 certified tables"
QUESTION = "How many participants in the treatment arm met the primary endpoint after the restatement?"


def hid() -> str:
    return uuid.uuid4().hex


tables = {
    "adeff": "Primary responder analysis dataset for study LMN-301 (one row per subject, PRIMRESP at Week 52). aval = 1 means responder, 0 means non-responder. This is the state after the Biostatistics restatement of 19 Oct 2026. adjudicated_at is the Clinical Endpoint Committee adjudication time.",
    "adsl": "Subject-level analysis dataset for LMN-301: arm ('LMN-4471 400 mg' or 'Placebo'), age, sex, country, randfl.",
    "efficacy_primary": "CERTIFIED by Biostatistics. Primary efficacy result per arm, current (restated) version. row_key TRT = LMN-4471 400 mg arm, PBO = placebo arm, DIFF = treatment difference. rate_pct, diff_pct, ci_low and ci_high are in percent or percentage points.",
    "safety_overview": "CERTIFIED by Biostatistics. Safety overview per arm: participants with any TEAE, serious AE, AE leading to discontinuation, and deaths. Unchanged by the restatement.",
}
space = {
    "version": 2,
    "config": {"sample_questions": [{"id": hid(), "question": [QUESTION]}]},
    "data_sources": {
        "tables": [{"identifier": f"{FQ}.{t}", "description": [d]} for t, d in sorted(tables.items())]
    },
    "instructions": {
        "text_instructions": [{
            "id": hid(),
            "content": [
                "You answer questions from regulatory reviewers about the synthetic Phase III study LMN-301 (LMN-4471 400 mg once daily vs placebo, 52 weeks). All data is synthetic.\n",
                "Prefer the certified tables efficacy_primary and safety_overview. Use adeff and adsl only for subject-level questions.\n",
                "efficacy_primary holds the current, restated result. When a question says 'after the restatement', use the current table without any version clause.\n",
                "Report counts as 'X of N' followed by the percentage with one decimal, for example '409 of 618 (66.2%)'. State the table and row_key you used.\n",
                "The treatment arm is row_key 'TRT' (arm 'LMN-4471 400 mg'), placebo is 'PBO', the difference row is 'DIFF'.\n",
            ],
        }],
        "example_question_sqls": [{
            "id": hid(),
            "question": [QUESTION],
            "sql": [f"SELECT responders, n, ROUND(rate_pct, 1) AS rate_pct FROM {FQ}.efficacy_primary WHERE row_key = 'TRT'"],
        }],
    },
}
out = subprocess.run(
    ["databricks", "genie", "create-space", WAREHOUSE, json.dumps(space), "--title", TITLE,
     "--description", "Answers questions about the certified LMN-301 efficacy and safety tables for the regulatory submission review demo (synthetic data).",
     "--profile", PROFILE, "-o", "json"],
    check=True, capture_output=True, text=True,
).stdout
print(out)
