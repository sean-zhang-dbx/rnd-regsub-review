"""Load the 5 ADaM .xpt files into Delta unchanged and upload the CSR PDF to the volume.

    uv run --python 3.12 --with pandas --with pyarrow --with pyreadstat --with databricks-sql-connector \
        python -I scripts/load_adam.py data_raw

The data folder is untrusted: this script is run with -I and only reads it.
Values are loaded as they are. SAS date columns (days since 1960-01-01) become DATE; empty
SAS numerics (NaN) become NULL; strings are kept as they are (including empty strings).
Checksum per table: sha256 over a canonical text form of the rows (sorted), computed on the
.xpt side and again on the Delta table read back; both must agree (must-be-true 1).
"""
import hashlib
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

EXPECTED_SHA = {
    "adae.xpt": "b8678e70946473a753bb01d002917f478bf51b59bdd0dc19587b97128059b6a0",
    "adqsadas.xpt": "ac3fa1217651810b0f15fe489fdda7d99eff10553ded025156ad7c1b89f84608",
    "adqscibc.xpt": "16e7118f606d907e817f0a5885d662c2e7177c430d2b3ec6c0ba9096cb3d7bc1",
    "adsl.xpt": "c5139f873a93ef6add77bc4297beb6460a398bbdd036874382a9f39dfc92091d",
    "adtte.xpt": "68513fc4126744b6b2c7328eb70eb7b9683865d12c58b36539325f3c0c0ab93d",
    "cdiscpilot01.pdf": "0cab016c76abb3dcaef31110611c95dbd9cd00df083b35e6d28fd69fca0d842d",
}
ROWS = {"adsl": 254, "adae": 1191, "adqsadas": 12463, "adqscibc": 730, "adtte": 254}
DATE_FORMATS = ("DATE", "YYMMDD", "E8601DA", "MMDDYY", "DDMMYY")
EPOCH = date(1960, 1, 1)
TITLES = {
    "adsl": "Subject-level analysis dataset (ADSL)",
    "adae": "Adverse events analysis dataset (ADAE)",
    "adqsadas": "ADAS-Cog (11) questionnaire analysis dataset (ADQSADAS)",
    "adqscibc": "CIBIC+ questionnaire analysis dataset (ADQSCIBC)",
    "adtte": "Time to event analysis dataset (ADTTE)",
}


def canon(v) -> str:
    """Canonical text of one value, identical on the xpt side and on the Delta side."""
    if v is None:
        return "\x00"
    if isinstance(v, float):
        if v != v:
            return "\x00"
        return repr(v)
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def rowkey(r) -> str:
    return "\x1f".join(canon(v) for v in r)


def table_checksum(cols, rows) -> str:
    h = hashlib.sha256()
    h.update("|".join(cols).encode())
    for r in sorted(rows, key=rowkey):
        h.update((rowkey(r) + "\n").encode())
    return h.hexdigest()


def main(data_dir: str) -> None:
    import pandas as pd
    import pyreadstat

    src = Path(data_dir)
    for name, want in EXPECTED_SHA.items():
        got = hashlib.sha256((src / name).read_bytes()).hexdigest()
        if got != want:
            raise SystemExit(f"hash mismatch for {name}: {got}")
    print("source file hashes verified")

    q = dbx.runner()
    dbx.fs_cp(str(src / "cdiscpilot01.pdf"), f"{dbx.VOL_SRC}/cdiscpilot01.pdf")
    for t in ROWS:
        dbx.fs_cp(str(src / f"{t}.xpt"), f"{dbx.VOL_SRC}/adam_xpt/{t}.xpt")
    stage = Path("/tmp/csrpod_stage")
    stage.mkdir(exist_ok=True)
    report = []
    for t, n_expected in ROWS.items():
        # pyreadstat, not pandas.read_sas: pandas decodes a SAS 0 as 5.397605346934028e-79 (IBM float zero bug),
        # which would change values. pyreadstat returns exactly the values in the file (checked: identical otherwise).
        df, meta = pyreadstat.read_xport(str(src / f"{t}.xpt"), disable_datetime_conversion=True)
        assert len(df) == n_expected, (t, len(df))
        cols = list(df.columns)
        # Date columns come from the SAS format in the file (DATE9. and similar), so none is missed.
        date_cols = {c for c, f in meta.original_variable_types.items() if (f or "").upper().startswith(DATE_FORMATS)}
        print(f"adam_{t}: date columns {sorted(date_cols)}")
        for c in cols:
            if c in date_cols:
                df[c] = df[c].map(lambda d: None if d != d else EPOCH + timedelta(days=int(d)))
        rows_x = [tuple(None if (isinstance(v, float) and v != v) else v for v in r)
                  for r in df.itertuples(index=False, name=None)]
        sum_x = table_checksum(cols, rows_x)
        pq = stage / f"{t}.parquet"
        df.to_parquet(pq, index=False)
        dbx.fs_cp(str(pq), f"{dbx.VOL_SRC}/_staging/{t}.parquet")
        fq = f"{dbx.FQ}.adam_{t}"
        q(f"CREATE OR REPLACE TABLE {fq} AS SELECT * FROM parquet.`{dbx.VOL_SRC}/_staging/{t}.parquet`")
        comment = f"{TITLES[t]}, loaded unchanged from {t}.xpt (SAS dates as DATE). {dbx.SOURCE_NOTE}"
        q(f"COMMENT ON TABLE {fq} IS '{dbx.esc(comment)}'")
        q(f"ALTER TABLE {fq} SET TAGS ({dbx.TAGS})")
        got = q(f"SELECT * FROM {fq}")
        got_cols = list(got[0].asDict().keys())
        rows_d = [tuple(r) for r in got]
        sum_d = table_checksum(got_cols, rows_d)
        ok = sum_x == sum_d and len(rows_d) == n_expected and got_cols == cols
        report.append((t, len(rows_d), len(cols), sum_x, ok))
        print(f"adam_{t}: rows {len(rows_d)} cols {len(cols)} checksum {sum_x} match={ok}")
        q(f"ALTER TABLE {fq} SET TBLPROPERTIES ('xpt_sha256'='{EXPECTED_SHA[t + '.xpt']}','content_checksum'='{sum_x}')")
    arms = q(f"SELECT ARM, COUNT(*) n FROM {dbx.FQ}.adam_adsl GROUP BY ARM ORDER BY ARM")
    print("arms:", {r[0]: r[1] for r in arms})
    if not all(r[4] for r in report):
        raise SystemExit("checksum mismatch")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data_raw")
