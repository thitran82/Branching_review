# Branching Review — corrected live OpenAlex prototype

This app operationalizes the **branching-review set logic** in a live OpenAlex discovery mode:

- **Depth branch** — journal/review records that cite a resolved seed paper.
- **Breadth branch** — journal/review records that satisfy an explicit topic rule in title, abstract, or keywords.
- **Convergent core** — records found by both branches.
- **Depth only / breadth only** — mutually exclusive regions after de-duplication.

## Important scope distinction

The manuscript's historical review corpus was assembled from **Web of Science + Scopus** and then screened by researchers. This OpenAlex app is **not** a record-for-record reproduction of that historical corpus. It is a live implementation of the branching logic and a discovery/validation scaffold.

Exact historical replication should be performed later by replaying the archived WoS and Scopus exports plus the recorded screening decisions.

## Corrected defaults

- Seed: **Oh, Agrawal & Rao (2013), MIS Quarterly**
- Correct DOI: `10.25300/MISQ/2013/37.2.05`
- Year window: 2014–2026
- Breadth rule: `rumor|rumour misinformation`

Breadth syntax:

- whitespace or `AND` = required concept groups
- `|` or `OR` = alternatives within a group
- quoted phrases are treated as one term

Example:

```text
rumor|rumour misinformation
```

means:

```text
(rumor OR rumour) AND misinformation
```

The app queries OpenAlex for each concept group and then verifies the rule against **title + abstract + keywords**. This is intentionally stricter than the earlier relevance-ranking implementation.

## Corrections in this version

1. Fixed the default seed DOI (`37.2.05`, not `37.2.02`).
2. Replaced the misleading UI labels “on-topic/off-topic” with retrieval-accurate branch descriptions.
3. Added strict post-retrieval topic matching for the breadth branch.
4. Added journal/review eligibility checks and obvious conference/proceedings rejection.
5. Added raw-source metadata warnings to help detect OpenAlex source-normalization errors.
6. Added DOI-first / OpenAlex-ID / title-year de-duplication keys before branch intersection.
7. Expanded the journal presets toward the manuscript's Appendix A scope and retained Information Systems Frontiers as a known-positive validation venue that must be reconciled with the manuscript's current appendix.
8. Added diagnostics for raw counts, strict breadth filtering, eligibility exclusions, and result-cap warnings.
9. Export CSV now includes raw venue, work/source type, and metadata warnings.

## Known validation controls

Use these as deliberate smoke tests after deployment:

### Positive control

**Tran et al. — “An Investigation of Misinformation Harms Related to Social Media during Two Humanitarian Crises”**

- DOI: `10.1007/s10796-020-10088-3`
- Venue: Information Systems Frontiers
- Expected: retrievable in the depth branch because it cites Oh et al. (2013); it may or may not also satisfy the breadth rule depending on the exact rule used.

### Topical negative control

**Patel et al. — “Design Principles for Crisis Mapping Platforms: Exploring Information in Crisis Messages Using Large Language Models”**

- Expected: should **not** pass a strict rumor/misinformation breadth rule merely because it concerns crisis information.

### Venue/type negative control

**Tran & Valecha — “Taxonomy of Misinformation Harms from Social Media in Humanitarian Crises” (AMCIS 2019 Proceedings)**

- Expected: should **not** survive the journal-only eligibility gate and should never be presented as a JAIS journal article.

## Journal presets

The live preset contains:

- AIS Senior Scholars' Basket of 11
- the ACM/IEEE venues listed in the manuscript appendix
- the interdisciplinary venues listed there
- Information Systems Frontiers as a known-positive legacy/validation venue

Before final manuscript submission, reconcile the manuscript Appendix A with the exact historical venue list actually used in the review.

## Run locally

Requirements: Node 18+ and Vercel CLI.

```bash
npm install
cp .env.example .env
# Put a NEW OpenAlex API key in .env; do not commit it.
vercel dev
```

## Deploy to Vercel

1. Push the project folder to GitHub.
2. Import the repo into Vercel.
3. Add environment variables:
   - `OPENALEX_API_KEY`
   - `OPENALEX_MAILTO`
4. Deploy.

**Security:** an OpenAlex key was previously embedded in a deployment document. Treat that key as compromised: revoke/rotate it and use a new key only in Vercel environment variables.

## Remaining limitation

Even after these fixes, OpenAlex coverage and metadata are not identical to WoS/Scopus. Final screening and theoretical interpretation remain researcher-led. Do not report live OpenAlex branch counts as if they were the manuscript's historical 78-paper corpus.

## Optional live Scopus mode

The corrected artifact now supports three live source modes:

- **OpenAlex** — open discovery mode.
- **Scopus** — official Scopus Search API.
- **OpenAlex + Scopus** — runs both sources and de-duplicates primarily by DOI, then normalized title + year.

To enable Scopus on a deployment, add the following server-side environment variable:

```text
SCOPUS_API_KEY=...
```

Depending on institutional entitlement, also add one of the supported authentication values:

```text
SCOPUS_INSTTOKEN=...
SCOPUS_AUTHTOKEN=...
```

The app never sends these credentials to the browser. Scopus live mode uses `TITLE-ABS-KEY(...)` for the breadth branch, `REF(...)` for the seed-citation branch, `SRCTYPE(j)`, article/review document types, the selected journal ISSNs, and the selected date range. In combined mode, Scopus metadata is preferred for venue/type fields when a DOI/title-year match joins an OpenAlex and Scopus record; OpenAlex topic metadata is preserved when available.

**Important:** live Scopus searching today is not the same as replaying the historical Scopus export used in the manuscript. Exact historical replication still requires the archived Scopus and WoS exports and recorded screening decisions.
