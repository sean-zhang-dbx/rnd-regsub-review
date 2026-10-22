"""Click-through of the CSR Pod demo in beat order (Playwright, chromium, against the local production build).

    uv run --with playwright python tools/ui_runthrough.py [http://localhost:8010]

Clicks every rail stop, X-ray marker, pod agent, Compare figure and page tab, the re-delivery button and every
sign-off button, and asserts what appears. It changes workspace state (re-delivery, sign-offs): run
scripts/reset_demo.py afterwards. Exit code 1 on any failure; screenshots go to /tmp/csrpod_runthrough/.
"""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8010"
ROOT = Path(__file__).resolve().parent.parent
LINKS = json.loads((ROOT / "config" / "demo-links.json").read_text())
SHOTS = Path("/tmp/csrpod_runthrough")
SHOTS.mkdir(exist_ok=True)
DEPARTMENTS = ["Medical Writing", "Biostatistics", "Clinical Safety"]

failures: list[str] = []
console_errors: list[str] = []


def check(name: str, fn) -> None:
    try:
        fn()
        print(f"PASS {name}")
    except Exception as e:  # noqa: BLE001
        failures.append(f"{name}: {str(e).splitlines()[0][:300]}")
        print(f"FAIL {name}: {str(e).splitlines()[0][:300]}")


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def rail(page: Page, label: str) -> None:
    page.get_by_role("navigation", name="Demo steps").get_by_role("link", name=label, exact=True).click()


def xray_markers(page: Page, screen: str) -> None:
    """Every marker on the screen opens the dark drawer with the object and the right link."""
    markers = page.locator("[data-xray-marker]")
    expect(markers.first).to_be_visible()
    for i in range(markers.count()):
        m = markers.nth(i)
        key = m.get_attribute("data-xray-marker")
        m.click()
        drawer = page.get_by_role("dialog")
        expect(drawer.get_by_text("What is behind this")).to_be_visible()
        link = drawer.get_by_role("link", name=re.compile("See it in Databricks"))
        href = link.get_attribute("href")
        target = link.get_attribute("target")
        expected = {
            "scorecard": "beat3_scores", "sources_adam": "beat1_adam", "sources_tlf": "beat1_tlf", "sources_docs": "beat1_docs",
            "sources_search": "beat1_search", "pod": "beat2", "pod_agents": "beat2_gateway", "compare": "beat3",
            "redelivery": "beat4", "signoff": "beat4_signoffs",
        }[key]
        want = LINKS[expected]["url"] if isinstance(LINKS[expected], dict) else LINKS[expected]
        assert href == want, f"{screen} marker {key}: link {href} != {want}"
        assert target == "_blank", f"{screen} marker {key}: link does not open in a new tab"
        page.keyboard.press("Escape")
        expect(drawer).to_be_hidden()


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        page.on("response", lambda r: console_errors.append(f"{r.status} {r.url}") if r.status >= 500 else None)

        # Opening: Scorecard
        page.goto(BASE + "/")
        headline = page.get_by_text(re.compile(r"from an empty ICH E3 template\. 0 figures typed by a model\."))

        def scorecard():
            expect(headline).to_be_visible(timeout=60_000)
            text = page.locator("main").inner_text()
            m = re.search(r"(\d+) of (\d+)\s+figures match the submitted CSR", text)
            assert m, "headline has no 'n of m figures match the submitted CSR'"
            loud = page.get_by_role("link").filter(has_text=re.compile(r"differ"))
            assert loud.count() == 1, f"{loud.count()} loud rows, expected 1"
            expect(loud).to_contain_text("12.2")
            assert "not part of this demo" in text, "the lab and vital signs note is missing"
            footer = page.get_by_text(re.compile(r"Data: CDISC SDTM/ADaM Pilot Project \(CDISCPILOT01\), used under the CDISC terms of use"))
            expect(footer).to_be_visible()
            shot(page, "1-scorecard")

        check("scorecard: headline, one loud row (12.2), attribution", scorecard)

        def xray_toggle():
            expect(page.locator("[data-xray-marker]")).to_have_count(0)
            page.keyboard.press("x")
            expect(page.locator("[data-xray-marker]").first).to_be_visible()
            xray_markers(page, "scorecard")
            page.get_by_role("switch", name="Show Databricks objects").click()
            expect(page.locator("[data-xray-marker]")).to_have_count(0)

        check("x-ray: X key and switch toggle markers; scorecard drawer and link", xray_toggle)

        # Beat 1: Sources
        def sources():
            rail(page, "Sources")
            expect(page.get_by_role("heading", name="The submitted report is the answer key. The pod cannot read it.")).to_be_visible(timeout=60_000)
            expect(page.get_by_text("adam_adsl", exact=True).first).to_be_visible(timeout=60_000)
            expect(page.get_by_text("doc_elements_index", exact=False)).to_be_visible(timeout=60_000)
            text = page.locator("main").inner_text()
            for t in ["adam_adsl", "adam_adae", "adam_adqsadas", "adam_adqscibc", "adam_adtte", "tlf_14_3_01_adascog_w24", "tlf_14_5_01_teae"]:
                assert t in text, f"{t} not shown"
            assert "doc_elements_index" in text, "index not shown"
            page.keyboard.press("x")
            xray_markers(page, "sources")
            page.keyboard.press("x")
            shot(page, "2-sources")

        check("sources: tables, documents, index; every marker", sources)

        # Beat 2: Pod
        def pod():
            rail(page, "Pod")
            nodes = page.locator("[data-node]")
            expect(nodes.first).to_be_visible(timeout=60_000)
            assert nodes.count() >= 5, f"{nodes.count()} pod nodes, expected 5 or more"
            for i in range(nodes.count()):
                name = nodes.nth(i).get_attribute("aria-label").replace(", open details", "")
                nodes.nth(i).click()
                drawer = page.get_by_role("dialog")
                expect(drawer.get_by_role("heading", name=name)).to_be_visible()
                if "Author" in name:
                    shot(page, "3b-pod-author")
                    assert re.search(r"search|AI Search", drawer.inner_text(), re.I), "author drawer shows no search calls"
                page.keyboard.press("Escape")
                expect(drawer).to_be_hidden()
            page.keyboard.press("x")
            xray_markers(page, "pod")
            page.keyboard.press("x")

        check("pod: every agent drawer opens; markers", pod)

        def replay():
            btn = page.get_by_role("button", name=re.compile("Replay the run|Replaying"))
            btn.click()
            expect(page.get_by_role("button", name="Replaying")).to_be_visible(timeout=10_000)
            expect(page.get_by_role("button", name="Replay the run")).to_be_enabled(timeout=180_000)
            shot(page, "3-pod-replayed")

        check("pod: replay the pre-run to the end", replay)

        # Beat 3: Compare (hero), from the scorecard row
        def compare():
            rail(page, "Scorecard")
            page.get_by_role("link").filter(has_text="11.4.1").click()
            expect(page).to_have_url(re.compile(r"/compare\?section=11\.4\.1"))
            hdr = page.get_by_text(re.compile(r"\d+ of \d+ figures in 11\.4\.1 match the submitted Table 14-3\.01"))
            expect(hdr).to_be_visible(timeout=60_000)
            n, m = map(int, re.search(r"(\d+) of (\d+)", hdr.inner_text()).groups())
            assert n == m and n > 0, f"header says {n} of {m}"
            ticks = page.locator("svg[aria-label='matches']")
            expect(ticks).to_have_count(m, timeout=30_000)
            assert page.locator("svg[aria-label='differs']").count() == 0, "a tick differs in 11.4.1"
            shot(page, "4a-compare-done")
            figs = page.locator("[data-figure]")
            assert figs.count() >= m, f"{figs.count()} tinted figures, {m} ticks"
            for i in range(min(figs.count(), 4)):
                figs.nth(i).hover()
                expect(page.get_by_test_id("reading")).to_contain_text(re.compile(r"drafted .+, printed .+"))
                expect(page.get_by_test_id("element-box").first).to_be_visible()
            shot(page, "4b-compare-hover")
            tabs = page.get_by_role("tablist", name="Pages of the submitted CSR").get_by_role("tab")
            for i in range(tabs.count()):
                tabs.nth(i).click()
                page.wait_for_function("() => [...document.images].some(i => i.src.includes('/api/page-image') && i.complete && i.naturalWidth > 0)")
            text = page.locator("main").inner_text()
            assert re.search(r"coverage", text, re.I), "wording panel has no coverage score"
            page.keyboard.press("x")
            xray_markers(page, "compare")
            page.keyboard.press("x")

        check("compare: all ticks match, hover reading and page box, page tabs, wording", compare)

        # Beat 4: re-delivery and sign-off, from the loud row
        def redeliver():
            rail(page, "Scorecard")
            page.get_by_role("link").filter(has_text=re.compile(r"differ")).click()
            expect(page).to_have_url(re.compile(r"/redelivery"))
            expect(page.get_by_role("heading", name=re.compile(r"Table 14-5\.01 version 1 counted all adverse events"))).to_be_visible(timeout=60_000)
            page.keyboard.press("x")
            xray_markers(page, "redelivery")
            page.keyboard.press("x")
            page.get_by_role("button", name="Biostatistics re-delivers Table 14-5.01").click()
            banner = page.get_by_role("status").filter(has_text="re-delivered")
            expect(banner).to_be_visible(timeout=120_000)
            b = banner.inner_text()
            assert "version 2: treatment-emergent events only" in b, f"banner: {b}"
            assert "version 1 used an incorrect derivation" in b, f"banner: {b}"
            assert "Demo scenario: the data is unchanged" in b, f"banner: {b}"
            expect(page.get_by_role("button", name=re.compile("A run is active|re-delivered"))).to_be_disabled()
            shot(page, "5a-redelivery-running")
            t0 = time.time()
            # The 12.2 row turns quiet when the redraft is scored.
            row = page.locator("main").get_by_text("12.2", exact=True).first
            expect(page.get_by_text(re.compile(r"\d+ differ"))).to_have_count(0, timeout=360_000)
            print(f"     redraft finished in {time.time() - t0:.0f} s")
            expect(row).to_be_visible()
            shot(page, "5b-redelivery-done")

        check("re-delivery: banner copy, button disabled while active, 12.2 turns quiet", redeliver)

        def signoff():
            def item(dept):
                return page.get_by_role("listitem").filter(has_text=re.compile(rf"{dept}, "))
            release = item("Regulatory Affairs").get_by_role("button", name="Release")
            expect(release).to_be_disabled(timeout=30_000)
            item("Medical Writing").get_by_role("button", name="Request changes").click()
            expect(item("Medical Writing")).to_contain_text("Changes requested", timeout=30_000)
            for d in DEPARTMENTS:
                item(d).get_by_role("button", name="Sign").click()
                expect(item(d)).to_contain_text("Approved", timeout=30_000)
                expect(item(d)).to_contain_text("signed against")
            expect(release).to_be_enabled(timeout=30_000)
            release.click()
            expect(item("Regulatory Affairs")).to_contain_text("Approved", timeout=30_000)
            v = item("Biostatistics").inner_text()
            assert "Table 14-5.01 v2" in v, f"Biostatistics did not sign against Table 14-5.01 v2: {v}"
            href = page.get_by_role("link", name="Export for Word").get_attribute("href")
            r = page.request.get(BASE + href)
            assert r.status == 200 and "msword" in r.headers.get("content-type", ""), f"export {r.status}"
            page.keyboard.press("x")
            xray_markers(page, "redelivery and sign-off")
            page.keyboard.press("x")
            shot(page, "5c-signed")

        check("sign-off: request changes, three signs, release, export", signoff)

        def rail_all():
            for label, path in [("Scorecard", "/"), ("Sources", "/sources"), ("Pod", "/pod"), ("Compare", "/compare"), ("Re-delivery and sign-off", "/redelivery")]:
                rail(page, label)
                expect(page).to_have_url(re.compile(re.escape(path) + r"($|\?)"))

        check("rail: every stop", rail_all)

        def no_console_errors():
            assert not console_errors, f"{len(console_errors)} console errors, first: {console_errors[:3]}"

        check("no console errors or 5xx responses", no_console_errors)
        browser.close()


if __name__ == "__main__":
    run()
    print(f"\n{len(failures)} failure(s)")
    for f in failures:
        print(" -", f)
    sys.exit(1 if failures else 0)
