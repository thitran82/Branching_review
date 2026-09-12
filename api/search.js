import { searchScopusBranches } from "./scopus.js";

// Vercel serverless function: /api/search
// Live OpenAlex discovery implementation of the branching-review logic.
//
// IMPORTANT: this endpoint is NOT the historical WoS+Scopus corpus replay.
// It performs a live OpenAlex search, applies explicit eligibility/topic gates,
// and then computes the depth-only / convergent-core / breadth-only partition.

const OPENALEX = "https://api.openalex.org";
const KEY = process.env.OPENALEX_API_KEY || "";
const MAILTO = process.env.OPENALEX_MAILTO || "";

// ---- tiny in-memory rate limiter (per warm instance) --------------------
const HITS = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

// ---- helpers ------------------------------------------------------------
function auth(params) {
  if (KEY) params.set("api_key", KEY);
  if (MAILTO) params.set("mailto", MAILTO);
  return params;
}

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

function rawWorkKey(w) {
  const doi = normDoi(w && w.doi);
  if (doi) return `doi:${doi}`;
  if (w && w.id) return `oa:${String(w.id).split("/").pop()}`;
  return `ty:${normText(w && w.title)}:${w && w.publication_year ? w.publication_year : ""}`;
}

function shapedWorkKey(w) {
  const doi = normDoi(w && w.doi);
  if (doi) return `doi:${doi}`;
  const title = normText(w && w.title);
  const year = w && w.year ? w.year : "";
  if (title) return `ty:${title}:${year}`;
  if (w && w.id) return `id:${String(w.id).split("/").pop()}`;
  return `unknown:${year}`;
}

function dedupeRaw(list) {
  const m = new Map();
  for (const w of list || []) {
    const k = rawWorkKey(w);
    if (!m.has(k)) m.set(k, w);
  }
  return [...m.values()];
}

function dedupeShaped(list) {
  const m = new Map();
  for (const w of list || []) {
    const k = shapedWorkKey(w);
    if (!m.has(k)) m.set(k, w);
  }
  return [...m.values()];
}

// Page through a filtered list with cursor paging. Returns truncation status so
// the UI can warn rather than silently treating a capped result as complete.
async function fetchAll(filter, { search, cap = 1200 } = {}) {
  const out = [];
  let cursor = "*";
  let truncated = false;
  const select =
    "id,doi,title,publication_year,authorships,primary_location,locations,cited_by_count," +
    "topics,keywords,concepts,abstract_inverted_index,type,open_access";

  while (cursor && out.length < cap) {
    const p = auth(new URLSearchParams());
    p.set("filter", filter);
    if (search) p.set("search", search);
    p.set("per_page", "100");
    p.set("cursor", cursor);
    p.set("select", select);
    const r = await fetch(`${OPENALEX}/works?${p.toString()}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`OpenAlex ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    const batch = data.results || [];
    out.push(...batch);
    cursor = data.meta && data.meta.next_cursor;
    if (!batch.length) break;
  }

  if (cursor && out.length >= cap) truncated = true;
  return { results: out.slice(0, cap), truncated };
}

// Reconstruct plain-text abstract from OpenAlex's inverted index.
function abstractText(inv) {
  if (!inv || typeof inv !== "object") return null;
  const positions = [];
  for (const [word, idxs] of Object.entries(inv)) {
    for (const i of idxs) positions.push([i, word]);
  }
  if (!positions.length) return null;
  positions.sort((a, b) => a[0] - b[0]);
  const text = positions.map((p) => p[1]).join(" ");
  return text.length > 4000 ? text.slice(0, 4000) + "…" : text;
}

// Syntax for the breadth rule:
//   whitespace / AND => required concept groups
//   | / OR           => alternatives inside one concept group
// Example: "rumor|rumour misinformation" => (rumor OR rumour) AND misinformation
function parseTopicRule(rule) {
  const src = String(rule || "").trim();
  if (!src) return [];
  const protectedPhrases = [];
  const masked = src.replace(/"([^"]+)"/g, (_, phrase) => {
    const token = `__PHRASE_${protectedPhrases.length}__`;
    protectedPhrases.push(phrase.trim());
    return token;
  });

  const required = masked
    .replace(/\s+AND\s+/gi, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .split(/\||\bOR\b/i)
        .map((t) => {
          const m = /^__PHRASE_(\d+)__$/.exec(t.trim());
          return m ? protectedPhrases[Number(m[1])] : t.trim();
        })
        .filter(Boolean)
    )
    .filter((g) => g.length);

  return required.slice(0, 6).map((g) => g.slice(0, 6));
}

function topicText(w) {
  const kws = (w.keywords || []).map((k) => k.display_name || k.keyword || "").join(" ");
  return normText(`${w.title || ""} ${abstractText(w.abstract_inverted_index) || ""} ${kws}`);
}

function metadataContainsTerm(hay, term) {
  const needle = normText(term);
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `) || hay.includes(needle);
}

function strictTopicMatch(w, groups) {
  if (!groups.length) return true;
  const hay = topicText(w);
  return groups.every((group) => group.some((term) => metadataContainsTerm(hay, term)));
}

function issnFilter(issns) {
  const clean = [...new Set((issns || []).map((s) => String(s || "").trim()).filter(Boolean))].slice(0, 100);
  if (!clean.length) return null;
  return `primary_location.source.issn:${clean.join("|")}`;
}

function conferenceLike(s) {
  return /\b(proceedings?|conference|symposium|workshop|amcis|icis|ecis|pacis|hicss)\b/i.test(String(s || ""));
}

function allowedJournalMap(journals) {
  const map = new Map();
  for (const j of journals || []) {
    const key = normIssn(j.issn);
    if (key) map.set(key, j.name || j.issn);
  }
  return map;
}

function eligibility(w, journalsByIssn) {
  const reasons = [];
  const warnings = [];
  const src = w.primary_location && w.primary_location.source;
  const primary = w.primary_location || {};
  const workType = String(w.type || "").toLowerCase();
  const sourceType = String((src && src.type) || "").toLowerCase();
  const rawType = String(primary.raw_type || "").toLowerCase();
  const rawName = primary.raw_source_name || "";

  // Historical review retained journal articles and reviews.
  if (workType && !["article", "review"].includes(workType)) {
    reasons.push(`work type is ${workType}`);
  }

  // Prevent obvious conference/proceedings records from surviving a bad source link.
  if (sourceType === "conference" || conferenceLike(rawType) || conferenceLike(rawName)) {
    reasons.push("conference/proceedings metadata conflicts with journal-only scope");
  }

  const srcIssns = [src && src.issn_l, ...((src && src.issn) || [])]
    .map(normIssn)
    .filter(Boolean);
  const matchedIssn = srcIssns.find((x) => journalsByIssn.has(x));
  if (!matchedIssn) {
    reasons.push("source ISSN is not in the selected journal set");
  }

  const expectedName = matchedIssn ? journalsByIssn.get(matchedIssn) : null;
  if (expectedName && rawName) {
    const rawN = normText(rawName);
    const expN = normText(expectedName);
    if (rawN && expN && !rawN.includes(expN) && !expN.includes(rawN)) {
      warnings.push(`raw source '${rawName}' differs from normalized source '${expectedName}'`);
    }
  }

  return { eligible: reasons.length === 0, reasons, warnings, matchedJournal: expectedName };
}

// Normalize a work into the compact shape the UI renders.
function shape(w, eligibilityInfo = null) {
  const src = w.primary_location && w.primary_location.source;
  const primary = w.primary_location || {};
  const authors = (w.authorships || [])
    .map((a) => a.author && a.author.display_name)
    .filter(Boolean);
  const topics = (w.topics || []).map((t) => ({
    name: t.display_name,
    subfield: t.subfield && t.subfield.display_name,
    field: t.field && t.field.display_name,
    domain: t.domain && t.domain.display_name,
    score: t.score,
  }));

  return {
    id: w.id,
    sourceIds: { openalex: w.id || null },
    sources: ["OpenAlex"],
    doi: w.doi || null,
    url: w.doi || w.id || null,
    title: w.title || "(untitled)",
    year: w.publication_year || null,
    authors,
    venue: src ? src.display_name : null,
    raw_venue: primary.raw_source_name || null,
    issn_l: src ? src.issn_l : null,
    source_type: src ? src.type || null : null,
    raw_type: primary.raw_type || null,
    cited_by: w.cited_by_count || 0,
    citationCounts: { OpenAlex: w.cited_by_count || 0 },
    type: w.type || null,
    is_oa: w.open_access ? w.open_access.is_oa : null,
    topics,
    primaryTopic: topics[0] || null,
    keywords: (w.keywords || []).map((k) => k.display_name || k.keyword).filter(Boolean),
    concepts: (w.concepts || [])
      .filter((c) => c.level <= 2 && c.score >= 0.3)
      .map((c) => c.display_name),
    abstract: abstractText(w.abstract_inverted_index),
    metadataWarnings: eligibilityInfo ? eligibilityInfo.warnings : [],
    matchedJournal: eligibilityInfo ? eligibilityInfo.matchedJournal : null,
  };
}

function mergeShapedRecords(list) {
  const m = new Map();
  for (const w of list || []) {
    const k = shapedWorkKey(w);
    if (!m.has(k)) {
      m.set(k, { ...w, sources: [...(w.sources || [])], sourceIds: { ...(w.sourceIds || {}) }, citationCounts: { ...(w.citationCounts || {}) } });
      continue;
    }
    const a = m.get(k);
    const b = w;
    const bIsScopus = (b.sources || []).includes("Scopus");
    const aIsScopus = (a.sources || []).includes("Scopus");
    const prefer = bIsScopus && !aIsScopus ? b : a;
    const other = prefer === a ? b : a;
    m.set(k, {
      ...other,
      ...prefer,
      id: prefer.id || other.id,
      doi: prefer.doi || other.doi,
      url: prefer.url || other.url,
      scopusUrl: prefer.scopusUrl || other.scopusUrl || null,
      title: prefer.title || other.title,
      year: prefer.year || other.year,
      authors: (prefer.authors || []).length >= (other.authors || []).length ? (prefer.authors || []) : (other.authors || []),
      venue: prefer.venue || other.venue,
      raw_venue: prefer.raw_venue || other.raw_venue,
      type: prefer.type || other.type,
      source_type: prefer.source_type || other.source_type,
      raw_type: prefer.raw_type || other.raw_type,
      abstract: prefer.abstract || other.abstract,
      topics: (a.topics || []).length ? a.topics : (b.topics || []),
      primaryTopic: a.primaryTopic || b.primaryTopic || null,
      keywords: [...new Set([...(a.keywords || []), ...(b.keywords || [])])],
      concepts: [...new Set([...(a.concepts || []), ...(b.concepts || [])])],
      sources: [...new Set([...(a.sources || []), ...(b.sources || [])])],
      sourceIds: { ...(a.sourceIds || {}), ...(b.sourceIds || {}) },
      citationCounts: { ...(a.citationCounts || {}), ...(b.citationCounts || {}) },
      metadataWarnings: [...new Set([...(a.metadataWarnings || []), ...(b.metadataWarnings || [])])],
      matchedJournal: prefer.matchedJournal || other.matchedJournal,
    });
  }
  return [...m.values()];
}

function breakdown(list) {
  const tally = (arr) => {
    const m = new Map();
    arr.forEach((x) => x && m.set(x, (m.get(x) || 0) + 1));
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  };
  const domains = [], fields = [], subfields = [], topics = [], keywords = [];
  list.forEach((w) => {
    if (w.primaryTopic) {
      domains.push(w.primaryTopic.domain);
      fields.push(w.primaryTopic.field);
      subfields.push(w.primaryTopic.subfield);
      topics.push(w.primaryTopic.name);
    }
    (w.keywords || []).forEach((k) => keywords.push(k));
  });
  return {
    domains: tally(domains),
    fields: tally(fields),
    subfields: tally(subfields).slice(0, 12),
    topics: tally(topics).slice(0, 12),
    keywords: tally(keywords).slice(0, 15),
    years: tally(list.map((w) => w.year).filter(Boolean)).sort(
      (a, b) => Number(a.name) - Number(b.name)
    ),
  };
}

async function fetchBreadthBoolean(jf, yearClause, groups) {
  if (!groups.length) return { results: [], truncated: false, candidateCount: 0 };

  const groupMaps = [];
  let anyTruncated = false;

  for (const group of groups) {
    const union = new Map();
    for (const term of group) {
      const { results, truncated } = await fetchAll(`${jf}${yearClause}`, { search: term, cap: 1200 });
      anyTruncated = anyTruncated || truncated;
      for (const w of results) union.set(rawWorkKey(w), w);
    }
    groupMaps.push(union);
  }

  // Intersection across required concept groups.
  let keys = new Set(groupMaps[0].keys());
  for (let i = 1; i < groupMaps.length; i += 1) {
    keys = new Set([...keys].filter((k) => groupMaps[i].has(k)));
  }

  const candidates = [...keys].map((k) => groupMaps[0].get(k));
  const strict = candidates.filter((w) => strictTopicMatch(w, groups));
  return { results: strict, truncated: anyTruncated, candidateCount: candidates.length };
}

// ---- handler ------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many searches in a short window. Wait a minute and try again." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }
  }

  const {
    seedId,
    seedMetadata,
    sourceMode = "openalex",
    keywords,
    issns,
    journals,
    yearFrom,
    yearTo,
    runDepth = true,
    runBreadth = true,
  } = body || {};

  const jf = issnFilter(Array.isArray(issns) ? issns : []);
  if (!jf) {
    res.status(400).json({ error: "Add at least one journal ISSN to filter on." });
    return;
  }

  const journalsByIssn = allowedJournalMap(Array.isArray(journals) ? journals : []);
  const topicGroups = parseTopicRule(keywords);

  let yearClause = "";
  if (yearFrom && yearTo) {
    yearClause = `,publication_year:${yearFrom}-${yearTo}`;
  } else if (yearFrom) {
    yearClause = `,publication_year:>${Number(yearFrom) - 1}`;
  } else if (yearTo) {
    yearClause = `,publication_year:<${Number(yearTo) + 1}`;
  }

  try {
    const wantOpenAlex = sourceMode === "openalex" || sourceMode === "both";
    const wantScopus = sourceMode === "scopus" || sourceMode === "both";
    if (!wantOpenAlex && !wantScopus) throw new Error("Unknown sourceMode. Use openalex, scopus, or both.");

    let depthFetch = { results: [], truncated: false };
    let breadthFetch = { results: [], truncated: false, candidateCount: 0 };
    const excluded = [];

    const gateOpenAlex = (rawList, branch) => {
      const kept = [];
      for (const w of dedupeRaw(rawList)) {
        const e = eligibility(w, journalsByIssn);
        if (e.eligible) kept.push(shape(w, e));
        else {
          excluded.push({
            source: "OpenAlex",
            branch,
            id: w.id,
            doi: w.doi || null,
            title: w.title || "(untitled)",
            year: w.publication_year || null,
            reasons: e.reasons,
            warnings: e.warnings,
          });
        }
      }
      return dedupeShaped(kept);
    };

    let openAlexDepth = [];
    let openAlexBreadth = [];
    if (wantOpenAlex) {
      if (runDepth && seedId) {
        const seedKey = seedId.startsWith("http")
          ? seedId.split("/").pop()
          : seedId.replace(/^doi:/i, "");
        const isDoi = seedKey.includes("10.");
        let depthSeedId = isDoi ? null : seedKey;

        if (!depthSeedId) {
          const p = auth(new URLSearchParams());
          const r = await fetch(`${OPENALEX}/works/doi:${encodeURIComponent(seedKey)}?${p.toString()}`);
          if (r.ok) {
            const d = await r.json();
            depthSeedId = (d.id || "").split("/").pop();
          }
        }

        if (!depthSeedId) throw new Error("Could not resolve the seed to an OpenAlex work ID.");
        depthFetch = await fetchAll(`cites:${depthSeedId},${jf}${yearClause}`, { cap: 1200 });
      }

      if (runBreadth && topicGroups.length) {
        breadthFetch = await fetchBreadthBoolean(jf, yearClause, topicGroups);
      }
      openAlexDepth = gateOpenAlex(depthFetch.results, "depth");
      openAlexBreadth = gateOpenAlex(breadthFetch.results, "breadth");
    }

    let scopusResult = { depth: [], breadth: [], excluded: [], diagnostics: null };
    if (wantScopus) {
      scopusResult = await searchScopusBranches({
        seed: seedMetadata,
        topicGroups,
        journals: Array.isArray(journals) ? journals : [],
        yearFrom,
        yearTo,
        runDepth,
        runBreadth,
        cap: 1200,
      });
      excluded.push(...(scopusResult.excluded || []));
    }

    const depth = mergeShapedRecords([...openAlexDepth, ...scopusResult.depth]);
    const breadth = mergeShapedRecords([...openAlexBreadth, ...scopusResult.breadth]);

    const depthMap = new Map(depth.map((w) => [shapedWorkKey(w), w]));
    const breadthMap = new Map(breadth.map((w) => [shapedWorkKey(w), w]));
    const overlapKeys = new Set([...depthMap.keys()].filter((k) => breadthMap.has(k)));

    const overlap = [...overlapKeys].map((k) => depthMap.get(k));
    const depthOnly = [...depthMap.entries()].filter(([k]) => !overlapKeys.has(k)).map(([, w]) => w);
    const breadthOnly = [...breadthMap.entries()].filter(([k]) => !overlapKeys.has(k)).map(([, w]) => w);

    res.status(200).json({
      mode: sourceMode === "both" ? "live-openalex-scopus" : `live-${sourceMode}`,
      topicRule: {
        raw: keywords || "",
        groups: topicGroups,
        semantics: "AND across groups; OR within | alternatives; verified against title/abstract/keywords",
      },
      counts: {
        depth: depth.length,
        breadth: breadth.length,
        overlap: overlap.length,
        depthOnly: depthOnly.length,
        breadthOnly: breadthOnly.length,
        total: depthOnly.length + breadthOnly.length + overlap.length,
      },
      diagnostics: {
        sourceMode,
        openalex: wantOpenAlex
          ? {
              depthRaw: depthFetch.results.length,
              breadthBooleanCandidates: breadthFetch.candidateCount,
              breadthAfterStrictMetadataMatch: breadthFetch.results.length,
              depthTruncated: depthFetch.truncated,
              breadthTruncated: breadthFetch.truncated,
            }
          : null,
        scopus: wantScopus ? scopusResult.diagnostics : null,
        excludedByEligibilityGate: excluded.length,
        warning:
          (wantOpenAlex && (depthFetch.truncated || breadthFetch.truncated)) ||
          (wantScopus && scopusResult.diagnostics && (scopusResult.diagnostics.depthTruncated || scopusResult.diagnostics.breadthTruncated))
            ? "At least one live search reached the configured cap; treat counts as incomplete until the cap/query is adjusted."
            : null,
      },
      excluded,
      breakdowns: {
        overlap: breakdown(overlap),
        depthOnly: breakdown(depthOnly),
        breadthOnly: breakdown(breadthOnly),
        all: breakdown([...depthOnly, ...overlap, ...breadthOnly]),
      },
      overlap,
      depthOnly,
      breadthOnly,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}

// Named exports make the core set/search logic testable without invoking Vercel.
export {
  parseTopicRule,
  strictTopicMatch,
  eligibility,
  rawWorkKey,
  shapedWorkKey,
  dedupeRaw,
  dedupeShaped,
  mergeShapedRecords,
};
