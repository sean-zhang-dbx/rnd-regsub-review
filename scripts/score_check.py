"""Printed-precision comparison shared by the checks (mirrors matchesPrinted in server/lib/pod/score.ts)."""
import re
from decimal import ROUND_HALF_UP, Decimal


def matches(drafted: str, printed: str) -> bool:
    p = printed.strip()
    d = float(drafted)
    m = re.match(r"^([<>])=?(\d*\.?\d+)$", p)
    if m:
        return d < float(m.group(2)) if m.group(1) == "<" else d > float(m.group(2))
    places = len(p.split(".")[1]) if "." in p else 0
    return Decimal(repr(d)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP) == Decimal(p)
