"""Generate the 6 synthetic source documents for volume source_docs.

    uv run --python 3.12 --with plutoprint python scripts/make_pdfs.py [OUT_DIR]

Writes HTML to OUT_DIR/html and PDFs to OUT_DIR/pdf (default /tmp/regsub_docs), using the
PDF converter of the databricks-unstructured-pdf-generation skill. Only the Investigator's
Brochure v7 and the advisory briefing book quote the pre-restatement result (412 of 618,
66.7%, "about two-thirds"). The other four documents mention LMN-301 but never that result.
"""
import subprocess
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/regsub_docs")
SKILL = Path.home() / ".claude/plugins/cache/claude-plugins-official/databricks/0.2.20/skills/databricks-unstructured-pdf-generation/scripts/pdf_generator.py"

CSS = """
@page { size: A4; margin: 22mm 20mm 22mm 20mm; @bottom-center { content: counter(page); font-size: 9pt; color: #555; } }
body { font-family: 'Helvetica', Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
h1 { font-size: 20pt; margin: 0 0 6pt 0; color: #14305a; }
h2 { font-size: 13pt; margin: 14pt 0 6pt 0; color: #14305a; border-bottom: 1px solid #9aa7b8; padding-bottom: 2pt; }
h3 { font-size: 11pt; margin: 10pt 0 4pt 0; }
.hdr { font-size: 8.5pt; color: #555; margin-bottom: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
.pb { break-before: page; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9.5pt; }
th, td { border: 1px solid #8a96a6; padding: 3pt 5pt; text-align: left; }
th { background: #e8edf3; }
.note { font-size: 8.5pt; color: #444; font-style: italic; }
"""


def page(title: str, body: str, first: bool = False) -> str:
    cls = "" if first else ' class="pb"'
    return f'<div{cls}>{body}</div>'


def doc(title: str, hdr: str, sections: list[tuple[str, str]]) -> str:
    out = [f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"]
    for i, (h, body) in enumerate(sections):
        cls = "" if i == 0 else ' class="pb"'
        head = f'<div class="hdr">{hdr}</div>'
        if i == 0:
            out.append(f'<div{cls}>{head}<h1>{title}</h1><h2>{h}</h2>{body}</div>')
        else:
            out.append(f'<div{cls}>{head}<h2>{h}</h2>{body}</div>')
    out.append("</body></html>")
    return "\n".join(out)


def p(*paras: str) -> str:
    return "".join(f"<p>{x}</p>" for x in paras)


def table(head: list[str], rows: list[list[str]]) -> str:
    h = "".join(f"<th>{c}</th>" for c in head)
    r = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows)
    return f"<table><tr>{h}</tr>{r}</table>"


STUDY = "LMN-301"
DRUG = "LMN-4471"
NOTE = "<p class='note'>Synthetic document created for a demonstration. Fictional compound and study. Not real clinical data.</p>"

# ------------------------------------------------------------------ Protocol v3
protocol = doc(
    f"Clinical Study Protocol {STUDY}, Version 3.0",
    f"{STUDY} Protocol v3.0 | Confidential | Fictional sponsor",
    [
        ("1. Protocol synopsis", p(
            f"<b>Title:</b> A 52-week, randomised, double-blind, placebo-controlled, parallel-group Phase III study of {DRUG} 400 mg once daily in adults with moderate to severe disease.",
            f"<b>Objectives:</b> The primary objective is to demonstrate the superiority of {DRUG} over placebo in the proportion of participants meeting the responder definition at Week 52. Key secondary objectives address time to first response, patient-reported symptom burden and safety.",
            "<b>Design:</b> Participants are randomised 1:1 to oral study drug or matching placebo, stratified by region and baseline severity. The study is conducted at approximately 60 sites in 10 countries. Total enrolment is planned at about 1,200 participants.",
            "<b>Duration:</b> Screening of up to 4 weeks, a 52-week treatment period, and a 4-week safety follow-up.",
        ) + NOTE),
        ("2. Background and study rationale", p(
            f"{DRUG} is an oral, selective inhibitor of a signalling kinase implicated in chronic inflammatory disease. Nonclinical models showed dose-dependent suppression of pathway biomarkers and a favourable margin to the no-observed-adverse-effect level in 13-week and 26-week toxicology studies.",
            "Two Phase II dose-ranging studies informed the selection of 400 mg once daily. The dose provided near-maximal pharmacodynamic effect with exposure that remained below the threshold of concern for hepatic enzyme elevations.",
            "The Phase III study is designed to provide the pivotal efficacy evidence for the initial marketing authorisation application, together with supportive safety exposure of at least 52 weeks.",
        )),
        ("3. Objectives and endpoints", table(
            ["Objective", "Endpoint"],
            [["Primary", "Proportion of participants meeting the responder definition at Week 52, adjudicated by the blinded Clinical Endpoint Committee"],
             ["Key secondary", "Change from baseline in symptom score at Week 24 and Week 52"],
             ["Key secondary", "Time to first response"],
             ["Safety", "Incidence of treatment-emergent adverse events, serious adverse events, discontinuations due to adverse events, and clinically significant laboratory abnormalities"]],
        ) + p("The responder definition is specified in Appendix B and is applied centrally. Participants who discontinue study treatment before Week 52 are classified as non-responders for the primary analysis.")),
        ("4. Eligibility criteria", p(
            "<b>Inclusion:</b> Adults aged 18 to 85 years with a documented diagnosis for at least 6 months; moderate to severe disease activity at screening and baseline; inadequate response to at least one conventional therapy; willingness to use contraception where applicable.",
            "<b>Exclusion:</b> Prior exposure to a pathway inhibitor of the same class; active serious infection; alanine aminotransferase above 2 times the upper limit of normal at screening; history of malignancy within 5 years other than treated non-melanoma skin cancer; pregnancy or breast-feeding.",
            "Eligibility is confirmed by the investigator and reviewed by the sponsor medical monitor before randomisation.",
        )),
        ("5. Treatment and assessment schedule", p(
            "Study drug is supplied as 200 mg tablets. Participants take two tablets once daily with or without food. Dose interruption is permitted for up to 14 consecutive days for safety reasons, after discussion with the medical monitor.",
        ) + table(
            ["Visit", "Week", "Key assessments"],
            [["Screening", "-4 to -1", "Eligibility, laboratory panel, ECG"],
             ["Baseline", "0", "Randomisation, symptom score, biomarkers"],
             ["Visit 4", "12", "Symptom score, safety laboratory"],
             ["Visit 6", "24", "Symptom score, pharmacokinetic sample"],
             ["Visit 9", "52", "Primary endpoint assessment, end of treatment"],
             ["Follow-up", "56", "Safety follow-up"]],
        )),
        ("6. Statistical considerations and safety oversight", p(
            "The sample size provides at least 90% power at a two-sided significance level of 0.05 to detect a treatment difference in response rate that is considered clinically meaningful, assuming a placebo response rate near 45% and allowing for 10% of participants to be non-evaluable.",
            "The primary analysis is detailed in the Statistical Analysis Plan. An independent Data Monitoring Committee reviews unblinded safety data approximately every 6 months and may recommend modification or termination of the study.",
            "Adverse events are coded with the current version of MedDRA and graded for severity. Serious adverse events are reported to the sponsor within 24 hours of site awareness.",
        )),
    ],
)

# ------------------------------------------------------------------ SAP v2
sap = doc(
    f"Statistical Analysis Plan {STUDY}, Version 2.0",
    f"{STUDY} SAP v2.0 | Confidential | Fictional sponsor",
    [
        ("1. Introduction and analysis sets", p(
            f"This Statistical Analysis Plan describes the planned analyses for Study {STUDY}, a 52-week Phase III study of {DRUG} 400 mg once daily versus placebo. It is finalised before database lock and unblinding.",
            "<b>Full analysis set (FAS):</b> all randomised participants, analysed as randomised. <b>Per-protocol set:</b> participants in the FAS without major protocol deviations affecting the primary endpoint. <b>Safety set:</b> all participants who received at least one dose of study drug, analysed as treated.",
        )),
        ("2. Primary endpoint analysis", p(
            "The primary endpoint is the proportion of participants meeting the responder definition at Week 52. The treatment difference in proportions will be estimated in the FAS, with a two-sided 95% confidence interval based on the Wald method. Superiority is tested with a Cochran-Mantel-Haenszel test stratified by region and baseline severity at a two-sided significance level of 0.05.",
            "Participants with missing Week 52 assessments, or who discontinue study treatment before Week 52, are counted as non-responders. Sensitivity analyses use multiple imputation under a missing-at-random assumption and a tipping-point analysis.",
            "The primary analysis will be repeated in the per-protocol set to assess robustness.",
        )),
        ("3. Secondary endpoints and multiplicity", p(
            "Key secondary endpoints are tested in a fixed hierarchical order, only if the primary endpoint is significant: change from baseline in symptom score at Week 52, change at Week 24, and time to first response. Continuous endpoints use a mixed model for repeated measures with treatment, visit, region, baseline value and the baseline-by-visit interaction.",
            "No multiplicity adjustment is applied to exploratory and subgroup analyses, which are presented descriptively.",
        )),
        ("4. Safety analyses and subgroup analyses", p(
            "Treatment-emergent adverse events are summarised by system organ class and preferred term, by severity and relationship, and by leading to discontinuation. Exposure-adjusted incidence rates are provided for events of special interest.",
            "Prespecified subgroups for the primary endpoint are age group, sex, region and baseline severity. Forest plots of the treatment difference are produced for each subgroup.",
        )),
        ("5. Tables, listings and figures", table(
            ["Output", "Title", "Population"],
            [["Table 14.2.1", "Primary endpoint responder analysis", "FAS"],
             ["Table 14.2.2", "Primary endpoint, per-protocol sensitivity", "Per-protocol"],
             ["Figure 14.2.1", "Subgroup forest plot", "FAS"],
             ["Table 14.3.1", "Overview of adverse events", "Safety"]],
        )),
    ],
)

# ------------------------------------------------------------------ Investigator's Brochure v7 (quotes OLD result on page 4)
ib = doc(
    f"Investigator's Brochure: {DRUG}, Edition 7",
    f"{DRUG} Investigator's Brochure v7 | Confidential | Fictional sponsor",
    [
        ("1. Summary", p(
            f"{DRUG} is an oral, selective kinase inhibitor in development for moderate to severe chronic inflammatory disease. This brochure provides investigators with the nonclinical, clinical and safety information needed to evaluate the study drug and the conduct of clinical studies. Edition 7 incorporates the primary Week 52 results of Study {STUDY}.",
            "The recommended dose in Phase III is 400 mg once daily. Common adverse events in clinical studies include upper respiratory tract infection, headache and nausea. No new safety signal was identified in the pivotal study.",
        ) + NOTE),
        ("2. Nonclinical studies", p(
            "Repeat-dose toxicology studies in two species of up to 26 weeks showed findings related to exaggerated pharmacology, including reversible changes in lymphoid tissue. The no-observed-adverse-effect level provided exposure margins above the clinical exposure at the 400 mg dose.",
            "Genotoxicity assays were negative. Embryo-fetal development studies showed effects at maternally toxic doses only; effective contraception is required in the clinical studies.",
        )),
        ("3. Clinical pharmacology", p(
            "After oral administration, maximum plasma concentration is reached within 2 hours. Steady state is reached by Day 5 with an accumulation ratio of about 1.4. Elimination half-life is approximately 11 hours. Exposure is increased modestly by food, which is not considered clinically relevant.",
            "Metabolism is primarily by CYP3A4. Co-administration with strong CYP3A4 inhibitors increased exposure and should be avoided.",
        )),
        ("4. Clinical efficacy: Study LMN-301", p(
            f"Study {STUDY} randomised 1,227 adults 1:1 to {DRUG} 400 mg once daily (618 participants) or placebo (609 participants) for 52 weeks. The primary endpoint was the proportion of participants meeting the responder definition at Week 52.",
            "<b>Primary result.</b> In the primary analysis, 412 of 618 (66.7%) participants in the LMN-4471 arm met the responder definition at Week 52, compared with 287 of 609 (47.1%) on placebo. The treatment difference was 19.5 percentage points (95% CI 14.1 to 25.0), in favour of LMN-4471.",
            "Treatment effects were directionally consistent across the prespecified subgroups of age, sex and region.",
        ) + table(
            ["Arm", "Responders", "Participants", "Response rate"],
            [["LMN-4471 400 mg", "412", "618", "66.7%"], ["Placebo", "287", "609", "47.1%"]],
        )),
        ("5. Safety in clinical studies", p(
            "In Study LMN-301, treatment-emergent adverse events were reported in 71.4% of participants receiving LMN-4471 and 68.8% receiving placebo. Serious adverse events occurred in 8.6% and 6.7% of participants, respectively. Adverse events led to discontinuation of study drug in 6.1% and 3.6% of participants.",
            "Two deaths were reported in the LMN-4471 arm and three in the placebo arm; none was considered related to study treatment by the investigator.",
        )),
        ("6. Guidance for the investigator", p(
            "Investigators should monitor liver enzymes at baseline, Week 4, Week 12 and every 12 weeks thereafter. Study drug should be interrupted for alanine aminotransferase above 3 times the upper limit of normal accompanied by symptoms, or above 5 times the upper limit of normal.",
            "Live vaccines should not be administered during treatment. Participants should be advised to report signs of infection promptly.",
        )),
    ],
)

# ------------------------------------------------------------------ Advisory briefing book draft (quotes OLD result on page 6)
book = doc(
    f"Advisory Committee Briefing Book (draft): {DRUG}",
    f"{DRUG} Advisory Briefing Book | DRAFT | Fictional sponsor",
    [
        ("Contents and purpose", p(
            f"This draft briefing book prepares the sponsor's presentation of {DRUG} to the advisory committee. It summarises the disease background, the mechanism of action, the clinical programme, efficacy, safety and the benefit-risk assessment, and lists the questions the sponsor proposes for committee discussion.",
            "Status: draft 3 for internal review by Regulatory Affairs, Clinical, Biostatistics and Medical Affairs.",
        ) + NOTE),
        ("1. Executive summary", p(
            f"{DRUG} 400 mg once daily was evaluated in one pivotal Phase III study and two Phase II studies. The pivotal study met its primary endpoint with a clinically meaningful and statistically significant benefit over placebo at Week 52, with a safety profile consistent with the class.",
            "The sponsor proposes an indication for adults with moderate to severe disease who have had an inadequate response to conventional therapy.",
        )),
        ("2. Disease background and unmet need", p(
            "The disease is a chronic, relapsing inflammatory condition with substantial impact on daily function and quality of life. Many patients do not reach an adequate response with conventional therapy, and existing targeted options require injection or infusion.",
            "An oral option with a once-daily regimen may reduce treatment burden and support earlier adoption of effective therapy.",
        )),
        ("3. Mechanism of action", p(
            f"{DRUG} selectively inhibits a signalling kinase that mediates the effect of several pro-inflammatory cytokines. Inhibition reduces downstream signalling and the expression of inflammatory mediators. Selectivity against related kinases was greater than 100-fold in biochemical assays.",
        )),
        ("4. Clinical development programme", table(
            ["Study", "Phase", "Design", "Participants"],
            [["LMN-101", "II", "Dose-ranging, 12 weeks", "About 250"],
             ["LMN-102", "II", "Dose-ranging, 24 weeks", "About 300"],
             [STUDY, "III", "Pivotal, 52 weeks, placebo-controlled", "1,227"]],
        ) + p("The programme provides at least 52 weeks of exposure to the proposed dose in more than 600 participants.")),
        ("5. Efficacy results", p(
            f"The primary endpoint in Study {STUDY} was the proportion of participants meeting the responder definition at Week 52. 412 of 618 (66.7%) participants receiving {DRUG} responded, compared with 287 of 609 (47.1%) receiving placebo.",
            "<b>About two-thirds of participants responded</b> to {0} by Week 52, and the difference from placebo was 19.5 percentage points (95% CI 14.1 to 25.0). The sponsor considers this effect clinically meaningful relative to the prespecified margin.".format(DRUG),
            "Key secondary endpoints, including change in symptom score, supported the primary result.",
        )),
        ("6. Safety", p(
            "Treatment-emergent adverse events were reported in 71.4% of participants receiving the study drug and 68.8% receiving placebo. Serious events were reported in 8.6% and 6.7%, and discontinuation due to adverse events in 6.1% and 3.6%. Hepatic enzyme elevations were generally mild and reversible.",
        )),
        ("7. Benefit-risk assessment and proposed questions for the committee", p(
            "The sponsor concludes that the benefits of treatment outweigh the identified risks in the proposed population, subject to liver enzyme monitoring and routine pharmacovigilance. A risk management plan is proposed with a post-authorisation safety study.",
            "1. Does the committee agree that the efficacy evidence supports a favourable effect in the proposed population?",
            "2. Does the committee consider the proposed liver enzyme monitoring adequate?",
            "3. Are further data needed on long-term safety beyond 52 weeks?",
        )),
    ],
)

# ------------------------------------------------------------------ DSUR 2025 (no efficacy result)
dsur = doc(
    f"Development Safety Update Report (DSUR) 2025: {DRUG}",
    f"{DRUG} DSUR 2025 | Reporting period 1 April 2025 to 31 March 2026 | Fictional sponsor",
    [
        ("1. Introduction and worldwide marketing status", p(
            f"This DSUR presents the annual review of safety information for {DRUG} for the reporting period. The product is not marketed in any country. Studies in the reporting period: two Phase II studies (completed) and Study {STUDY} (Phase III, enrolment complete, ongoing and blinded).",
        ) + NOTE),
        ("2. Actions taken for safety reasons and exposure", p(
            "No clinical studies were terminated or suspended for safety reasons. No protocol amendments were made for safety reasons. The Investigator's Brochure was updated once to reflect the cumulative safety experience.",
            "Cumulative exposure across the programme exceeds 1,000 participant-years. Exposure by study is presented in Appendix 1.",
        )),
        ("3. Summary of safety data", p(
            f"Because Study {STUDY} remains blinded, safety is reviewed by the independent Data Monitoring Committee, which met twice during the period and recommended continuation without modification. Serious adverse events reported in blinded studies are listed in Appendix 3.",
            "Events of special interest include hepatic enzyme elevations, serious infections and herpes zoster. No new risks were identified in the reporting period.",
        )),
        ("4. Overall safety assessment and conclusions", p(
            "The benefit-risk profile of the investigational product remains acceptable for the ongoing studies. The risk minimisation measures in the protocols, including liver enzyme monitoring and infection surveillance, are considered adequate.",
        )),
    ],
)

# ------------------------------------------------------------------ Plain-language summary draft (no efficacy result)
pls = doc(
    f"Plain-Language Summary (draft): Study {STUDY}",
    f"{STUDY} Plain-Language Summary | DRAFT | Fictional sponsor",
    [
        ("Why was this study done?", p(
            f"Study {STUDY} looked at a new tablet, called {DRUG}, for adults with a long-term inflammatory condition that had not improved enough with usual treatments. Researchers wanted to know whether the tablet helps people feel better and whether it is safe to take for a year.",
            "People in the study were chosen by chance to take either the new tablet or a placebo, which looks the same but has no active medicine. Neither the participants nor the study staff knew who took which.",
        ) + NOTE),
        ("What happened during the study?", p(
            "More than 1,000 adults from 10 countries joined the study. Each person took one dose each day for 52 weeks and visited the clinic regularly for checks, blood tests and questionnaires about how they felt.",
            "An independent group of experts looked at safety information while the study was running to make sure that people were protected.",
        )),
        ("What were the results?", p(
            "The full results are still being checked and are not final. This summary will be updated with the main results, and with what they mean, once the review by the study team and by regulators is complete.",
            "We thank everyone who took part in the study. Taking part helps researchers learn more about how to treat this condition.",
        )),
    ],
)

FILES = {
    "LMN-301_Protocol_v3": protocol,
    "LMN-301_SAP_v2": sap,
    "LMN-4471_Investigators_Brochure_v7": ib,
    "LMN-4471_Advisory_Briefing_Book_draft": book,
    "LMN-4471_DSUR_2025": dsur,
    "LMN-301_Plain_Language_Summary_draft": pls,
}

html_dir = OUT / "html"
pdf_dir = OUT / "pdf"
html_dir.mkdir(parents=True, exist_ok=True)
for name, content in FILES.items():
    (html_dir / f"{name}.html").write_text(content, encoding="utf-8")
subprocess.run([sys.executable, str(SKILL), "convert", "--input", str(html_dir), "--output", str(pdf_dir), "--force"], check=True)
print(sorted(x.name for x in pdf_dir.glob("*.pdf")))
