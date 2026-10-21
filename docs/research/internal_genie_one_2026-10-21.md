# Internal research for the document-drafting PRD (Genie One, 21 Oct 2026)

Collected with Genie One (`databricks genie ask -p logfood`) over internal Slack, email, Drive, Jira and Salesforce. Internal only: do not share outside Databricks. Items marked UNVERIFIED had no source Genie One could cite.

## 1. Databricks customers and partners doing regulated writing

| Who | What | Status | Source |
|---|---|---|---|
| AstraZeneca, Velocia | Agentic workspace for clinical study design and authoring on Databricks Apps and Lakebase | In delivery; about 100 users targeted by Q1 2027; third extension in pipeline | Slack #astrazeneca_velocia (Varun Bhandary) https://databricks.enterprise.slack.com/archives/C05218E7QJZ/p1791210475502649 ; AZ weekly update 18 Sep 2026 https://databricks.enterprise.slack.com/archives/C038PCEFVNY/p1789753671772419 |
| Biogen with MathCo, Project Vector | CSR medical writing from protocol, SAP and TLF outputs, each claim linked to source evidence; goal multi-week to 2.5 hours | UAT October, launch November 2026 | Salesforce use case https://databricks.lightning.force.com/lightning/r/UseCase__c/aAvVp000001mTITKA2/view |
| Royal FrieslandCampina, DragonGate | Agentic generation of regulatory dossiers (infant formula, medical nutrition) | Won July 2026, paid FDE engagement | Slack https://databricks.enterprise.slack.com/archives/C7942AHLG/p1785155888724679 |
| GSK | Health Authority Responses and Content Generation Service live on Databricks | Live | UK HLS FE FY27 plan https://docs.google.com/presentation/d/12z55ns6lEkye3hCcGMRcZupNGXFd_oUwIh9VbKiaZlI/edit |
| Sun Pharma (partner ScriptLanes) | 2 Databricks Apps for a regulatory workflow, multi-agent | Latency escalation resolved 20 Oct 2026 | Jira ES-2247511, ES-1881341 |
| Crinetics with Slalom | Regulatory document creation with audit trails | Target 1 Apr 2026, appears to have slipped | Transition doc https://drive.google.com/file/d/1whbhtFRmKrKpe-OzeWvnTIuqRxNoCnT0HkvRJVci4Xk |
| Beam | Wants CMC Module 3 reports generated from process data | Discovery (Aug 2026) | https://drive.google.com/file/d/1BiYpQXJ9J0Dw0Cy8Uxd7vkyOzW6-5Jqz3Rg19HqJpaM |
| Tiger Analytics (partner) | CSR generator accelerator: parsing, summarisation, report generation, validation | Partner asset | Genie One, no link returned (UNVERIFIED detail) |
| Paradigm Health (Built-On), Accumulus (OpenSharing) | Clinical trial workflows; data exchange with regulators | Check go/reffy and account owners before naming externally | Mike Sanky, Slack https://databricks.enterprise.slack.com/archives/C0C8Q4D2EMS/p1792077240725099 |

Novo Nordisk NovoScribe (CSR drafting) is an Anthropic customer story; there is no evidence that it runs on Databricks. Novo's FounData and StudyHub do.

Gap: no public Databricks case study of AI drafting a CSR, Module 2, DSUR/PBRER, Module 3 or label in production.

## 2. Field assets
- GSK "AI for regulatory submission" deck and the rnd_regsub_review demo (Sean Zhang): the most complete field asset on this topic.
- Agent Pod Platform spec with a CSR Drafter and ICH E3 skill (Bimal Sebastian), "Future of Pharma R&D POV" https://drive.google.com/file/d/1mHSvIKv3fXjPhQIgkyKnxfGugTGsMSwxmQ6-6JoP16Y
- SherlockAML workshop (regulated narrative generation, FSI), Jira FEIP-5834.
- Regulatory Risk Copilot with Agent Bricks (public blog) https://www.databricks.com/blog/building-regulatory-risk-copilot-databricks-agent-bricks-part-1-information-extraction
- GxP-Compliant Workloads on Databricks whitepaper v2.3, customer-shareable https://docs.google.com/document/d/1CZKCpYzwRl2jFCAu6MxJQAFrlJZfmrHMHgk0jPxZNM8/edit ; go/gxp
- GxP and Part 11 guide app (HLS team, Neha Pande), Slack #industry-hls https://databricks.enterprise.slack.com/archives/CGX5SJ19D/p1791398521773759
- No packaged HLS accelerator, play or go/ link for regulatory writing. FY27 AI Platform Plays: closest is Play 4, Intelligent Document Processing.

## 3. Product status relevant to the architecture (as reported by Genie One, Oct 2026)

| Feature | Status | Source |
|---|---|---|
| Agent Bricks CLI | Beta (29 Sep 2026) | https://learn.microsoft.com/en-us/azure/databricks/agents/custom-agents/agent-bricks-cli/ |
| Durable Agent Runtime (DurableAgentServer, run state on Lakebase) | Recommended for new agents; no preview label found | https://learn.microsoft.com/en-us/azure/databricks/agents/deploy/agent-runtime/ |
| Knowledge Assistant, Supervisor Agent | Legacy since 12 Oct 2026; Supervisor API deprecated | https://learn.microsoft.com/en-us/azure/databricks/agents/legacy/index/ |
| Genie Agents | GA; Flash mode and MCP connectors Beta | https://learn.microsoft.com/en-us/azure/databricks/genie-agents/index/ |
| Unity Gateway | GA (release notes: 4 Aug 2026); service policies, Skills API, agent services Beta | go/unity-ai-gateway/faq |
| MLflow 3 tracing and evaluation | GA; production monitoring Beta | Docs |
| Lakeflow Jobs (for-each, if/else) | GA | Docs |
| Lakebase | GA; agent sessions and memory Beta | Docs |
| ai_parse_document | GA | Docs; Sev1 ES-2138026 below |
| ai_prep_search | Beta | Docs |
| AI Search | GA; dedicated full-text indexes Beta | Docs |
| Veeva Vault connector (Lakeflow Connect) | Beta; unstructured documents a fast follow | Slack #industry-hls https://databricks.enterprise.slack.com/archives/CGX5SJ19D/p1785283524569109 |

## 4. FDE model
- Professional Services became Forward Deployed Engineering in May 2026. Lifecycle: investment-backed pilot, then fixed-price build, then enhancement. Typical MVP about 6 weeks, production under 3 months. https://databricks.atlassian.net/wiki/spaces/FOCUS/pages/2732885342/GTM+FDE+Enablement+Process
- Pricing direction: away from T&M toward fixed-fee milestones; T&M still used. Slack C08KBMXRLKV; Jira BSECPQ-13036.
- Investment: pilots often funded; the Accelerate fund expects a consumption return and customer co-funding. Slack C04SY8T282V, C08NYM66U6B.

## 5. GxP, validation and objections
- Shared responsibility: Databricks provides controls, logs, SDLC evidence and change management; the customer owns validation scope and IQ/OQ/PQ. Databricks is not GxP-certified; the pattern is to qualify the platform and validate each use case. https://databricks.atlassian.net/wiki/spaces/GTM/pages/4979392961/GxP
- For agents: freeze a versioned agent in Unity Catalog and MLflow, IQ/OQ/PQ, promote dev to test to prod; run a GxP workstream in the SOW (AstraZeneca Velocia pattern).
- Purgo AI (partner) automates IQ/OQ and Part 11 work. Slack #pills-and-pixels https://databricks.enterprise.slack.com/archives/C0BDSHX48FJ/p1787766940288249
- Reproducibility is the hardest objection: concede it, do not oversell determinism; offer pinned models, lineage, deterministic code for figures and humans for interpretation. Madhu session debrief https://drive.google.com/file/d/1-5AQ-U2UUw49wxxKa2UqkVVPxnz44RtQT7c2fnY6Ljk
- Model retirement: pay-per-token models get about 3 months' notice; provisioned throughput about 6 months and is not exempt. Jira ML-70760; Slack C05AAPK63DK.
- Audit: system table audit retention can be shorter than documented; copy logs on a schedule. Slack C0BTCFUL9QV.
- Part 11: no native e-signature; sign-off records are custom and must be validated by the customer.
- Data residency for UK South: cross-geo processing and written commitments for Foundation Model APIs are not settled. https://docs.google.com/document/d/1D04EshgQ5a-6wPBHtl4AKc_Ht6Aa05hn9Xiwg5RaQUA/edit
- Sev1 ES-2138026: the document parser changed or invented 10 of 287 values on clean PDFs while reporting confidence 1.00. Parsed numbers must not be used as figures.
- Serverless has no pinnable runtime version, which complicates validation evidence.

## 6. GTM context
- Mike Sanky leads clinical operations GTM (go/clinicaltrials) and handed the regulatory-document story to Sean.
- Christina Busmalis (Industry Solutions, reports to Mike): the Biopharma R&D PoV deck treats regulatory work under "better clinical trials"; no named regulatory play. https://docs.google.com/presentation/d/1T27V1zRc5ApPWR5YcubDWPyuIqKLMXV4VQ6Km2b5T5U/edit
- UK HLS FY27 plan item: "cut regulatory response time with GenAI" (GSK).
- Competition: Anthropic is treated as a partner on the reasoning layer; point-solution vendors (Artos AI, Ketryx) as Built-On partners.

## 7. Elanco
- Hayley Johanson asked for a regulatory-submission POC after Johnathan Jackson co-built an animal-health clinical site optimiser with Elanco. Slack https://databricks.enterprise.slack.com/archives/C0BDSHX48FJ/p1792508563788569
- Christina introduced Sean on 20 Oct. https://databricks.enterprise.slack.com/archives/C0CA89S9887/p1792508787652189
- No requirements yet: which documents (FDA CVM, EMA veterinary, USDA CVB), where the data lives, SARB requirements, and whether it is for the November EBC.
- Elanco may be a Veeva Vault customer (UNVERIFIED).
