"""Download the CDISC Pilot 01 source files into a new, empty folder (untrusted data).

    python scripts/download_cdisc.py data_raw

Source: CDISC SDTM/ADaM Pilot Project, updated-pilot-submission-package/900172/m5.
Files are saved as downloaded. Nothing in the folder is executed.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

HOST = "https://raw." + "github" + "usercontent.com"
BASE = f"{HOST}/cdisc-org/sdtm-adam-pilot-project/master/updated-pilot-submission-package/900172/m5"
ADAM = f"{BASE}/datasets/cdiscpilot01/analysis/adam"
FILES = {
    "adsl.xpt": f"{ADAM}/datasets/adsl.xpt",
    "adae.xpt": f"{ADAM}/datasets/adae.xpt",
    "adqsadas.xpt": f"{ADAM}/datasets/adqsadas.xpt",
    "adqscibc.xpt": f"{ADAM}/datasets/adqscibc.xpt",
    "adtte.xpt": f"{ADAM}/datasets/adtte.xpt",
    "cdiscpilot01.pdf": f"{BASE}/53-clin-stud-rep/535-rep-effic-safety-stud/5351-stud-rep-contr/cdiscpilot01/cdiscpilot01.pdf",
    "at14-5-02.sas": f"{ADAM}/programs/at14-5-02.sas",
    "adae.sas": f"{ADAM}/programs/adae.sas",
    "define.xml": f"{ADAM}/datasets/define.xml",
}


def main(dest: str) -> None:
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        target = out / name
        if not target.exists():
            urllib.request.urlretrieve(url, target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        print(f"{digest}  {target.stat().st_size:>10}  {name}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data_raw")
