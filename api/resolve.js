// Vercel serverless function: /api/resolve
// Two small lookups the UI needs before running a review:
//   ?type=seed&q=<doi or title>   -> one work {id, title, year, authors, doi}
//   ?type=journal&q=<name>        -> up to 8 sources {id, name, issn_l, issns}
// Keeps the OpenAlex key server-side.

const OPENALEX = "https://api.openalex.org";
const KEY = process.env.OPENALEX_API_KEY || "";
const MAILTO = process.env.OPENALEX_MAILTO || "";

function auth(params) {
  if (KEY) params.set("api_key", KEY);
  if (MAILTO) params.set("mailto", MAILTO);
  return params;
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
      let url;
      if (looksDoi) {
        const doi = q.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
        p.set("select", "id,doi,title,publication_year,authorships");
        url = `${OPENALEX}/works/doi:${encodeURIComponent(doi)}?${p.toString()}`;
      } else {
        p.set("search", q);
        p.set("per_page", "1");
        p.set("select", "id,doi,title,publication_year,authorships");
        url = `${OPENALEX}/works?${p.toString()}`;
      }
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
      const data = await r.json();
      const w = looksDoi ? data : (data.results || [])[0];
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
          .slice(0, 6),
      });
      return;
    }

    if (type === "journal") {
      const p = auth(new URLSearchParams());
      p.set("search", q);
      p.set("per_page", "8");
      p.set("select", "id,display_name,issn_l,issn,works_count");
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
        })),
      });
      return;
    }

    res.status(400).json({ error: "Unknown type." });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
