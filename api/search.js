// Vercel serverless function: /api/search
// Runs the branching review against OpenAlex.
// Holds the OpenAlex key server-side (never exposed to the browser) and adds a
// light per-IP rate limit so a single visitor cannot drain the daily budget.

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

// Page through a filtered list with cursor paging, capped so one request can
// never runaway. Returns a flat array of work objects (selected fields only).
async function fetchAll(filter, { search, cap = 600 } = {}) {
  const out = [];
  let cursor = "*";
  const select =
    "id,doi,title,publication_year,authorships,primary_location,cited_by_count," +
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
    out.push(...(data.results || []));
    cursor = data.meta && data.meta.next_cursor;
    if (!data.results || data.results.length === 0) break;
  }
  return out;
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
  // OpenAlex caps abstracts; keep it bounded for token safety downstream.
  return text.length > 2000 ? text.slice(0, 2000) + "\u2026" : text;
}

// Normalize a work into the compact shape the UI renders.
function shape(w) {
  const src = w.primary_location && w.primary_location.source;
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
    doi: w.doi || null,
    title: w.title || "(untitled)",
    year: w.publication_year || null,
    authors,
    venue: src ? src.display_name : null,
    issn_l: src ? src.issn_l : null,
    cited_by: w.cited_by_count || 0,
    type: w.type || null,
    is_oa: w.open_access ? w.open_access.is_oa : null,
    topics,
    primaryTopic: topics[0] || null,
    keywords: (w.keywords || []).map((k) => k.display_name || k.keyword).filter(Boolean),
    concepts: (w.concepts || [])
      .filter((c) => c.level <= 2 && c.score >= 0.3)
      .map((c) => c.display_name),
    abstract: abstractText(w.abstract_inverted_index),
  };
}

// Aggregate a paper list into topic/domain/field/keyword frequency breakdowns.
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

// OpenAlex cannot express (A OR B) AND (C OR D) across attributes in one call
// for search, and a paired keyword like "rumor AND misinformation" is safest
// run as a single relevance search then intersected with the journal filter,
// which the filter already enforces. We pass the phrase via `search`.
function issnFilter(issns) {
  const clean = issns
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100); // OpenAlex OR cap
  if (!clean.length) return null;
  return `primary_location.source.issn:${clean.join("|")}`;
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
    res
      .status(429)
      .json({ error: "Too many searches in a short window. Wait a minute and try again." });
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
    seedId, // OpenAlex work ID or DOI, already resolved client-side
    keywords, // string, e.g. "rumor misinformation"
    issns, // array of ISSNs
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

  // Build the year filter explicitly. OpenAlex accepts a closed range
  // (2013-2026), an open lower bound (>2012), or an open upper bound (<2027).
  let yearClause = "";
  if (yearFrom && yearTo) {
    yearClause = `,publication_year:${yearFrom}-${yearTo}`;
  } else if (yearFrom) {
    yearClause = `,publication_year:>${Number(yearFrom) - 1}`;
  } else if (yearTo) {
    yearClause = `,publication_year:<${Number(yearTo) + 1}`;
  }

  try {
    const tasks = {};

    if (runDepth && seedId) {
      const seedKey = seedId.startsWith("http")
        ? seedId.split("/").pop()
        : seedId.replace(/^doi:/i, "");
      const isDoi = seedKey.includes("10.");
      const cites = isDoi
        ? // resolve DOI to ID first would be ideal; OpenAlex accepts cites: with W id only,
          // so the client sends a resolved W id. If a DOI slips through, we look it up.
          null
        : seedKey;
      let depthSeedId = cites;
      if (!depthSeedId) {
        const p = auth(new URLSearchParams());
        const r = await fetch(
          `${OPENALEX}/works/doi:${encodeURIComponent(seedKey)}?${p.toString()}`
        );
        if (r.ok) {
          const d = await r.json();
          depthSeedId = (d.id || "").split("/").pop();
        }
      }
      if (depthSeedId) {
        tasks.depth = fetchAll(`cites:${depthSeedId},${jf}${yearClause}`);
      }
    }

    if (runBreadth && keywords && keywords.trim()) {
      // Journal filter enforces the "quality" gate; `search` provides relevance
      // ranking across title/abstract/fulltext for the keyword phrase.
      tasks.breadth = fetchAll(`${jf}${yearClause}`, { search: keywords.trim() });
    }

    const [depthRaw, breadthRaw] = await Promise.all([
      tasks.depth || Promise.resolve([]),
      tasks.breadth || Promise.resolve([]),
    ]);

    const depth = depthRaw.map(shape);
    const breadth = breadthRaw.map(shape);

    // overlap by OpenAlex work id
    const depthIds = new Set(depth.map((w) => w.id));
    const breadthIds = new Set(breadth.map((w) => w.id));
    const overlapIds = new Set([...depthIds].filter((id) => breadthIds.has(id)));

    const overlap = depth.filter((w) => overlapIds.has(w.id));
    const depthOnly = depth.filter((w) => !overlapIds.has(w.id));
    const breadthOnly = breadth.filter((w) => !overlapIds.has(w.id));

    res.status(200).json({
      counts: {
        depth: depth.length,
        breadth: breadth.length,
        overlap: overlap.length,
        depthOnly: depthOnly.length,
        breadthOnly: breadthOnly.length,
        total: depthOnly.length + breadthOnly.length + overlap.length,
      },
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
