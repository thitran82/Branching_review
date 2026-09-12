// Vercel serverless function: /api/resolve
// Seed and journal lookups for the live OpenAlex mode.

const OPENALEX = "https://api.openalex.org";
const KEY = process.env.OPENALEX_API_KEY || "";
const MAILTO = process.env.OPENALEX_MAILTO || "";

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

function titleScore(query, title) {
  const q = new Set(normText(query).split(" ").filter(Boolean));
  const t = new Set(normText(title).split(" ").filter(Boolean));
  if (!q.size || !t.size) return 0;
  let hit = 0;
  q.forEach((x) => t.has(x) && hit++);
  return hit / new Set([...q, ...t]).size;
}

export default async function handler(req, res) {
  const type = (req.query.type || "").toString();
  const q = (req.query.q || "").toString().trim();
  if (!q) {
    res.status(400).json({ error: "Missing q." });
    return;
  }

  try {
    if (type === "seed") {
      const looksDoi = /10\.\d{4,}/.test(q);
      const p = auth(new URLSearchParams());
      let w;

      if (looksDoi) {
        const doi = q.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
        p.set("select", "id,doi,title,publication_year,authorships");
        const r = await fetch(`${OPENALEX}/works/doi:${encodeURIComponent(doi)}?${p.toString()}`);
        if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
        w = await r.json();
      } else {
        p.set("search", q);
        p.set("per_page", "10");
        p.set("select", "id,doi,title,publication_year,authorships");
        const r = await fetch(`${OPENALEX}/works?${p.toString()}`);
        if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
        const data = await r.json();
        const candidates = data.results || [];
        candidates.sort((a, b) => titleScore(q, b.title) - titleScore(q, a.title));
        w = candidates[0];
      }

      if (!w) {
        res.status(404).json({ error: "No matching paper found." });
        return;
      }

      res.status(200).json({
        id: (w.id || "").split("/").pop(),
        fullId: w.id,
        doi: w.doi || null,
        title: w.title || "(untitled)",
        year: w.publication_year || null,
        authors: (w.authorships || [])
          .map((a) => a.author && a.author.display_name)
          .filter(Boolean)
          .slice(0, 8),
      });
      return;
    }

    if (type === "journal") {
      const p = auth(new URLSearchParams());
      p.set("search", q);
      p.set("per_page", "8");
      p.set("select", "id,display_name,issn_l,issn,works_count,type");
      const r = await fetch(`${OPENALEX}/sources?${p.toString()}`);
      if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
      const data = await r.json();
      res.status(200).json({
        results: (data.results || []).map((s) => ({
          id: s.id,
          name: s.display_name,
          issn_l: s.issn_l || null,
          issns: s.issn || [],
          works: s.works_count || 0,
          type: s.type || null,
        })),
      });
      return;
    }

    res.status(400).json({ error: "Unknown type." });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
