// Optional live Scopus adapter for the branching-review artifact.
//
// Server-side environment variables:
//   SCOPUS_API_KEY       required for live Scopus calls
//   SCOPUS_INSTTOKEN     optional institutional token
//   SCOPUS_AUTHTOKEN     optional end-user auth token
//
// This adapter uses the official Scopus Search API. It is a live discovery
// source, not a replay of the historical exports used in the manuscript.

const SCOPUS_API = "https://api.elsevier.com/content/search/scopus";
const API_KEY = process.env.SCOPUS_API_KEY || "";
const INSTTOKEN = process.env.SCOPUS_INSTTOKEN || "";
const AUTHTOKEN = process.env.SCOPUS_AUTHTOKEN || "";

function normText(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normIssn(s) {
  return String(s || "").toUpperCase().replace(/[^0-9X]/g, "");
}

function normDoi(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
}

function scopusConfigured() {
  return Boolean(API_KEY);
}

function scopusHeaders() {
  if (!API_KEY) {
    throw new Error(
      "Scopus is not configured on this deployment. Add SCOPUS_API_KEY in Vercel; " +
      "for subscriber-level access also configure SCOPUS_INSTTOKEN or a supported auth token."
    );
  }
  const h = {
    Accept: "application/json",
    "X-ELS-APIKey": API_KEY,
  };
  if (INSTTOKEN) h["X-ELS-Insttoken"] = INSTTOKEN;
  if (AUTHTOKEN) h["X-ELS-Authtoken"] = AUTHTOKEN;
  return h;
}

function quoteScopus(s) {
  return `"${String(s || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

function authorSurname(seed) {
  const first = seed && Array.isArray(seed.authors) ? seed.authors[0] : "";
  const parts = String(first || "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/[^A-Za-z'-]/g, "") : "";
}

function seedReferencePhrase(seed) {
  const title = String((seed && seed.title) || "").trim();
  if (!title) return "";
  const head = title.split(/[:—–-]/)[0].trim();
  const words = head.split(/\s+/).filter(Boolean);
  // The title head is usually stable in reference metadata and is less brittle
  // than requiring a complete subtitle.
  return (words.length >= 4 ? words.slice(0, 10).join(" ") : title).trim();
}

function buildDepthCore(seed) {
  const title = seedReferencePhrase(seed);
  const year = Number(seed && seed.year);
  const surname = authorSurname(seed);
  if (!title || !year) {
    throw new Error("Scopus depth search requires a resolved seed title and publication year.");
  }
  const bits = [quoteScopus(title)];
  if (surname) bits.push(surname);
  bits.push(String(year));
  // REF(...) requires the terms to occur in the same cited reference record.
  return `REF(${bits.join(" ")})`;
}

function buildBreadthCore(groups) {
  if (!Array.isArray(groups) || !groups.length) return "";
  return groups
    .map((group) => {
      const terms = (group || []).map((t) => String(t || "").trim()).filter(Boolean);
      if (!terms.length) return null;
      const inner = terms.map((t) => quoteScopus(t)).join(" OR ");
      return `TITLE-ABS-KEY(${inner})`;
    })
    .filter(Boolean)
    .join(" AND ");
}

function buildJournalChunks(journals, size = 16) {
  const issns = [...new Set((journals || []).map((j) => normIssn(j.issn)).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < issns.length; i += size) chunks.push(issns.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

function journalClause(chunk) {
  if (!chunk.length) return "";
  return `(${chunk.map((issn) => `ISSN(${issn})`).join(" OR ")})`;
}

function completeQuery(core, chunk) {
  const pieces = [core, journalClause(chunk), "SRCTYPE(j)", "DOCTYPE(ar OR re)"].filter(Boolean);
  return pieces.join(" AND ");
}

function entryList(data) {
  const root = data && data["search-results"];
  if (!root) return [];
  const entries = root.entry || [];
  return Array.isArray(entries) ? entries.filter((e) => e && !e.error) : [];
}

function totalResults(data) {
  const root = data && data["search-results"];
  return Number((root && root["opensearch:totalResults"]) || 0) || 0;
}

async function fetchScopusQuery(query, { yearFrom, yearTo, cap = 1200 } = {}) {
  const out = [];
  let start = 0;
  const count = 25;
  let total = null;
  let truncated = false;

  while (out.length < cap && (total === null || start < total)) {
    const p = new URLSearchParams();
    p.set("query", query);
    p.set("view", "COMPLETE");
    p.set("count", String(count));
    p.set("start", String(start));
    p.set("suppressNavLinks", "true");
    if (yearFrom || yearTo) {
      const from = yearFrom || yearTo;
      const to = yearTo || yearFrom;
      p.set("date", `${from}-${to}`);
    }

    const r = await fetch(`${SCOPUS_API}?${p.toString()}`, { headers: scopusHeaders() });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Scopus ${r.status}: ${body.slice(0, 300)}`);
    }
    const data = await r.json();
    if (total === null) total = totalResults(data);
    const batch = entryList(data);
    out.push(...batch);
    if (!batch.length) break;
    start += batch.length;
  }

  if (total !== null && out.length < total && out.length >= cap) truncated = true;
  return { entries: out.slice(0, cap), truncated, total: total || out.length, query };
}

function entryAuthors(e) {
  const authors = Array.isArray(e.author) ? e.author : e.author ? [e.author] : [];
  const names = authors
    .map((a) => a && (a.authname || [a["given-name"], a.surname].filter(Boolean).join(" ")))
    .filter(Boolean);
  if (names.length) return names;
  return e["dc:creator"] ? [e["dc:creator"]] : [];
}

function entryKeywords(e) {
  const raw = e.authkeywords || e["authkeywords"] || "";
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "object" && raw) {
    const maybe = raw["author-keyword"] || raw.keyword;
    return Array.isArray(maybe) ? maybe.map(String).filter(Boolean) : maybe ? [String(maybe)] : [];
  }
  return String(raw || "")
    .split(/\s*[|;]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function entryScopusUrl(e) {
  const links = Array.isArray(e.link) ? e.link : e.link ? [e.link] : [];
  const scopus = links.find((l) => l && (l["@ref"] === "scopus" || l.ref === "scopus"));
  return (scopus && (scopus["@href"] || scopus.href)) || null;
}

function mapSubtype(e) {
  const code = String(e.subtype || "").toLowerCase();
  const desc = String(e.subtypeDescription || "").toLowerCase();
  if (code === "ar" || desc === "article") return "article";
  if (code === "re" || desc === "review") return "review";
  return desc || code || null;
}

function selectedJournalName(e, journals) {
  const recordIssns = [e["prism:issn"], e["prism:eIssn"], e["prism:eissn"]]
    .map(normIssn)
    .filter(Boolean);
  for (const j of journals || []) {
    if (recordIssns.includes(normIssn(j.issn))) return j.name;
  }
  const src = normText(e["prism:publicationName"] || "");
  if (src) {
    const exact = (journals || []).find((j) => normText(j.name) === src);
    if (exact) return exact.name;
  }
  return null;
}

function shapeScopus(e, journals) {
  const cover = String(e["prism:coverDate"] || "");
  const year = Number(cover.slice(0, 4)) || null;
  const doi = normDoi(e["prism:doi"] || "");
  const eid = e.eid || String(e["dc:identifier"] || "").replace(/^SCOPUS_ID:/i, "");
  const venue = e["prism:publicationName"] || null;
  const type = mapSubtype(e);
  const sourceType = String(e["prism:aggregationType"] || "").toLowerCase() || null;
  const matchedJournal = selectedJournalName(e, journals);
  const warnings = [];
  if (!matchedJournal) warnings.push("Scopus record did not map back to the selected journal set by ISSN/title");
  if (sourceType && sourceType !== "journal") warnings.push(`Scopus aggregation type is ${sourceType}`);
  if (type && !["article", "review"].includes(type)) warnings.push(`Scopus document type is ${type}`);

  return {
    id: `scopus:${eid || doi || normText(e["dc:title"])}`,
    sourceIds: { scopus: eid || null },
    sources: ["Scopus"],
    doi: doi || null,
    url: doi ? `https://doi.org/${doi}` : entryScopusUrl(e),
    scopusUrl: entryScopusUrl(e),
    title: e["dc:title"] || "(untitled)",
    year,
    authors: entryAuthors(e),
    venue,
    raw_venue: venue,
    issn_l: e["prism:issn"] || e["prism:eIssn"] || null,
    source_type: sourceType,
    raw_type: e.subtypeDescription || e.subtype || null,
    cited_by: Number(e["citedby-count"] || 0) || 0,
    citationCounts: { Scopus: Number(e["citedby-count"] || 0) || 0 },
    type,
    is_oa: e.openaccess === "1" || e.openaccess === 1 || null,
    topics: [],
    primaryTopic: null,
    keywords: entryKeywords(e),
    concepts: [],
    abstract: e["dc:description"] || null,
    metadataWarnings: warnings,
    matchedJournal,
  };
}


function scopusEligibility(w) {
  const reasons = [];
  const type = String(w.type || "").toLowerCase();
  const sourceType = String(w.source_type || "").toLowerCase();
  if (type && !["article", "review"].includes(type)) reasons.push(`Scopus document type is ${type}`);
  if (sourceType && sourceType !== "journal") reasons.push(`Scopus aggregation type is ${sourceType}`);
  if (!w.matchedJournal) reasons.push("Scopus record did not map back to the selected journal set");
  return { eligible: reasons.length === 0, reasons };
}

function entryKey(e) {
  const doi = normDoi(e["prism:doi"] || "");
  if (doi) return `doi:${doi}`;
  const title = normText(e["dc:title"] || "");
  const year = String(e["prism:coverDate"] || "").slice(0, 4);
  if (title) return `ty:${title}:${year}`;
  return `id:${e.eid || e["dc:identifier"] || Math.random()}`;
}

function dedupeEntries(entries) {
  const m = new Map();
  for (const e of entries || []) {
    const k = entryKey(e);
    if (!m.has(k)) m.set(k, e);
  }
  return [...m.values()];
}

async function searchAcrossJournalChunks(core, journals, opts) {
  const chunks = buildJournalChunks(journals);
  const entries = [];
  const queries = [];
  let truncated = false;
  let totalReported = 0;

  for (const chunk of chunks) {
    const query = completeQuery(core, chunk);
    const r = await fetchScopusQuery(query, opts);
    queries.push(query);
    entries.push(...r.entries);
    truncated = truncated || r.truncated;
    totalReported += r.total;
  }

  return {
    entries: dedupeEntries(entries),
    truncated,
    totalReported,
    queries,
  };
}

async function searchScopusBranches({
  seed,
  topicGroups,
  journals,
  yearFrom,
  yearTo,
  runDepth = true,
  runBreadth = true,
  cap = 1200,
}) {
  if (!scopusConfigured()) scopusHeaders(); // throws a useful configuration error

  let depth = { entries: [], truncated: false, totalReported: 0, queries: [] };
  let breadth = { entries: [], truncated: false, totalReported: 0, queries: [] };

  if (runDepth) {
    depth = await searchAcrossJournalChunks(buildDepthCore(seed), journals, {
      yearFrom,
      yearTo,
      cap,
    });
  }
  if (runBreadth) {
    const core = buildBreadthCore(topicGroups);
    if (!core) throw new Error("Scopus breadth search requires at least one topic group.");
    breadth = await searchAcrossJournalChunks(core, journals, { yearFrom, yearTo, cap });
  }

  const excluded = [];
  const gate = (entries, branch) => {
    const kept = [];
    for (const e of entries) {
      const w = shapeScopus(e, journals);
      const check = scopusEligibility(w);
      if (check.eligible) kept.push(w);
      else excluded.push({
        source: "Scopus",
        branch,
        id: w.id,
        doi: w.doi,
        title: w.title,
        year: w.year,
        reasons: check.reasons,
        warnings: w.metadataWarnings || [],
      });
    }
    return kept;
  };

  return {
    depth: gate(depth.entries, "depth"),
    breadth: gate(breadth.entries, "breadth"),
    excluded,
    diagnostics: {
      depthRaw: depth.entries.length,
      breadthRaw: breadth.entries.length,
      depthReportedAcrossChunks: depth.totalReported,
      breadthReportedAcrossChunks: breadth.totalReported,
      depthTruncated: depth.truncated,
      breadthTruncated: breadth.truncated,
      depthQueries: depth.queries,
      breadthQueries: breadth.queries,
      credentialMode: INSTTOKEN ? "API key + institution token" : AUTHTOKEN ? "API key + auth token" : "API key / IP entitlement",
    },
  };
}

export {
  scopusConfigured,
  buildDepthCore,
  buildBreadthCore,
  buildJournalChunks,
  shapeScopus,
  scopusEligibility,
  searchScopusBranches,
};
