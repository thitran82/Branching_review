# Scopus setup for the Branching Review artifact

The artifact supports **OpenAlex**, **Scopus**, or **OpenAlex + Scopus** live discovery.

## Environment variables

Set these only on the server/deployment (for example Vercel Environment Variables):

```text
SCOPUS_API_KEY=...
SCOPUS_INSTTOKEN=...      # optional, if issued/required by your institution
SCOPUS_AUTHTOKEN=...      # optional alternative supported by Elsevier authentication
```

Do not commit credentials to GitHub and do not expose them in client-side code.

## What the Scopus adapter does

- Breadth branch: `TITLE-ABS-KEY(...)` Boolean query.
- Depth branch: cited-reference `REF(...)` query built from the resolved seed title head, first-author surname, and year.
- Scope restrictions: selected ISSNs, `SRCTYPE(j)`, `DOCTYPE(ar OR re)`, and the selected date range.
- Pagination: Scopus Search API with COMPLETE view.
- Combined mode: DOI-first, then normalized title+year cross-source de-duplication.
- Provenance: retains whether each record came from OpenAlex, Scopus, or both.
- Citation counts: keeps OpenAlex and Scopus counts separate.

## Important access limitation

Elsevier's Scopus API requires an API key. Subscriber-level content can depend on institutional IP authentication or an institutional/authentication token. A public Vercel deployment may therefore have different entitlement behavior from a browser running on a university network.

## Historical replication

Live Scopus today is not a record-for-record replay of the archived Scopus search used in the manuscript. Exact historical reproduction still requires the archived Scopus and Web of Science exports and the original screening decisions.
