// Vercel serverless function: /api/synthesize
// OPTIONAL, bring-your-own-key. The user supplies their own Anthropic API key,
// which is used only to make this one call and is never stored or logged.
// Input: a set of papers (title + abstract) and which group they came from.
// Output: a structured synthesis (themes, methods, gaps) in the model's words.
//
// Cost is borne by the user's key, not the site owner's.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // fast + inexpensive for abstract-level synthesis
const MAX_PAPERS = 60; // hard cap to bound token cost per call

function buildPrompt(papers, context) {
  const lines = papers.map((p, i) => {
    const a = p.abstract ? p.abstract : "(no abstract available)";
    const meta = [p.year, p.venue].filter(Boolean).join(", ");
    return `[${i + 1}] ${p.title}${meta ? " (" + meta + ")" : ""}\n${a}`;
  });
  return `You are helping a research team synthesize a set of academic papers retrieved by a literature-review tool. The papers below belong to the "${context}" group of a branching review on rumors and misinformation as a social cybersecurity problem.

Analyze ONLY the papers provided. Do not invent citations or findings not present in the text. Where the abstracts are thin, say so rather than speculating.

Produce a concise synthesis with these sections:
1. Dominant themes (3-6 bullet points, each naming the theme and the papers by their [number] that support it)
2. Methods and data in evidence (what approaches and platforms recur)
3. Notable gaps or open questions the set points to
4. One-sentence takeaway characterizing this group

Keep it under 400 words. Use plain, precise language.

PAPERS:
${lines.join("\n\n")}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
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

  const { apiKey, papers, context = "selected" } = body || {};

  if (!apiKey || !/^sk-ant-/.test(apiKey)) {
    res.status(400).json({
      error:
        "A valid Anthropic API key is required (starts with sk-ant-). It is used only for this request and never stored.",
    });
    return;
  }
  if (!Array.isArray(papers) || papers.length === 0) {
    res.status(400).json({ error: "No papers provided to synthesize." });
    return;
  }

  const trimmed = papers.slice(0, MAX_PAPERS).map((p) => ({
    title: p.title,
    abstract: p.abstract,
    year: p.year,
    venue: p.venue,
  }));

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [
          { role: "user", content: buildPrompt(trimmed, context) },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      // Surface Anthropic's own error (bad key, rate limit, etc.) cleanly.
      const msg =
        (data && data.error && data.error.message) ||
        `Anthropic API error ${r.status}`;
      res.status(r.status === 401 ? 401 : 502).json({ error: msg });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.status(200).json({
      synthesis: text,
      used: {
        papers: trimmed.length,
        model: MODEL,
        input_tokens: data.usage ? data.usage.input_tokens : null,
        output_tokens: data.usage ? data.usage.output_tokens : null,
      },
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
