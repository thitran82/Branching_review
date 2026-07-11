import React, { useState, useMemo, useCallback } from "react";
import { PRESETS, DEFAULT_SEED, DEFAULT_KEYWORDS } from "./presets";

// ---------------------------------------------------------------------------
// Branching Review — a two-branch literature scan on OpenAlex.
// Depth branch: papers citing a seed, within a journal basket.
// Breadth branch: papers matching a keyword phrase, within the same basket.
// The intersection is the convergent core.
// ---------------------------------------------------------------------------

const flatPreset = (keys) =>
  keys.flatMap((k) => PRESETS[k].map((j) => ({ ...j, group: k })));

const ALL_GROUPS = Object.keys(PRESETS);

export default function App() {
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED.query);
  const [seed, setSeed] = useState(null); // resolved {id, title, year, authors}
  const [seedStatus, setSeedStatus] = useState({ state: "idle", msg: "" });

  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [journals, setJournals] = useState(flatPreset(ALL_GROUPS));
  const [yearFrom, setYearFrom] = useState(2013);
  const [yearTo, setYearTo] = useState(new Date().getFullYear());

  const [runDepth, setRunDepth] = useState(true);
  const [runBreadth, setRunBreadth] = useState(true);

  const [jInput, setJInput] = useState("");
  const [jMatches, setJMatches] = useState([]);
  const [jLooking, setJLooking] = useState(false);

  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overlap");
  const [view, setView] = useState("papers"); // "papers" | "breakdown"

  // Optional bring-your-own-key synthesis
  const [showSynth, setShowSynth] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [synth, setSynth] = useState({}); // { [group]: text }
  const [synthBusy, setSynthBusy] = useState(false);
  const [synthErr, setSynthErr] = useState("");

  const issns = useMemo(
    () => journals.map((j) => j.issn).filter(Boolean),
    [journals]
  );

  // --- resolve seed -------------------------------------------------------
  const resolveSeed = useCallback(async () => {
    const q = seedInput.trim();
    if (!q) return;
    setSeedStatus({ state: "loading", msg: "Looking up paper…" });
    try {
      const r = await fetch(`/api/resolve?type=seed&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Lookup failed");
      setSeed(d);
      setSeedStatus({ state: "ok", msg: "" });
    } catch (e) {
      setSeed(null);
      setSeedStatus({ state: "error", msg: e.message });
    }
  }, [seedInput]);

  // --- journal search -----------------------------------------------------
  const searchJournal = useCallback(async () => {
    const q = jInput.trim();
    if (!q) return;
    setJLooking(true);
    setJMatches([]);
    try {
      const r = await fetch(`/api/resolve?type=journal&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Lookup failed");
      setJMatches(d.results || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setJLooking(false);
    }
  }, [jInput]);

  const addJournal = (m) => {
    const issn = m.issn_l || (m.issns && m.issns[0]);
    if (!issn) return;
    if (journals.some((j) => j.issn === issn)) return;
    setJournals((prev) => [...prev, { name: m.name, issn, group: "Custom" }]);
    setJMatches([]);
    setJInput("");
  };

  const removeJournal = (issn) =>
    setJournals((prev) => prev.filter((j) => j.issn !== issn));

  const loadPreset = (key) => setJournals(flatPreset([key]));
  const loadAllPresets = () => setJournals(flatPreset(ALL_GROUPS));

  // --- run ----------------------------------------------------------------
  const run = useCallback(async () => {
    setError("");
    setResults(null);
    if (!issns.length) {
      setError("Add at least one journal to filter on.");
      return;
    }
    if (runDepth && !seed) {
      setError("Resolve a seed paper first, or turn off the depth branch.");
      return;
    }
    if (runBreadth && !keywords.trim()) {
      setError("Enter a keyword phrase, or turn off the breadth branch.");
      return;
    }
    setRunning(true);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedId: seed ? seed.id : null,
          keywords,
          issns,
          yearFrom,
          yearTo,
          runDepth,
          runBreadth,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      setResults(d);
      setSynth({});
      setView("papers");
      setTab(d.counts.overlap > 0 ? "overlap" : "depthOnly");
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [issns, seed, keywords, yearFrom, yearTo, runDepth, runBreadth]);

  // --- export -------------------------------------------------------------
  const exportCsv = () => {
    if (!results) return;
    const rows = [
      ["group", "title", "authors", "year", "venue", "doi", "cited_by"],
    ];
    const push = (list, label) =>
      list.forEach((w) =>
        rows.push([
          label,
          w.title,
          w.authors.join("; "),
          w.year || "",
          w.venue || "",
          w.doi || "",
          w.cited_by,
        ])
      );
    push(results.overlap, "overlap");
    push(results.depthOnly, "depth-only");
    push(results.breadthOnly, "breadth-only");
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "branching-review.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runSynthesis = useCallback(
    async (list, groupLabel) => {
      setSynthErr("");
      if (!apiKey.trim()) {
        setSynthErr("Enter your Anthropic API key first.");
        return;
      }
      if (!list || !list.length) {
        setSynthErr("No papers in this group to synthesize.");
        return;
      }
      setSynthBusy(true);
      try {
        const r = await fetch("/api/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: apiKey.trim(),
            context: groupLabel,
            papers: list.map((w) => ({
              title: w.title,
              abstract: w.abstract,
              year: w.year,
              venue: w.venue,
            })),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Synthesis failed");
        setSynth((prev) => ({ ...prev, [tab]: d }));
      } catch (e) {
        setSynthErr(e.message);
      } finally {
        setSynthBusy(false);
      }
    },
    [apiKey, tab]
  );

  const groupedJournals = useMemo(() => {
    const g = {};
    journals.forEach((j) => {
      (g[j.group] = g[j.group] || []).push(j);
    });
    return g;
  }, [journals]);

  const activeList =
    results &&
    (tab === "overlap"
      ? results.overlap
      : tab === "depthOnly"
      ? results.depthOnly
      : results.breadthOnly);

  const activeBreakdown =
    results && results.breakdowns ? results.breakdowns[tab] : null;

  const groupLabel =
    tab === "overlap"
      ? "convergent core"
      : tab === "depthOnly"
      ? "depth only"
      : "breadth only";

  const activeSynth = synth[tab];

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="mark" aria-hidden="true">
          <span className="node depth" />
          <span className="edge e1" />
          <span className="edge e2" />
          <span className="node core" />
          <span className="edge e3" />
          <span className="edge e4" />
          <span className="node breadth" />
        </div>
        <div>
          <h1>Branching Review</h1>
          <p className="tag">
            Trace a seed paper's lineage and a topic's breadth across your
            field's journals — and find where they converge.
          </p>
        </div>
      </header>

      <main className="grid">
        {/* ---------------- controls ---------------- */}
        <section className="panel controls">
          {/* seed */}
          <div className="block">
            <div className="block-head">
              <span className="branch-dot depth" />
              <h2>Depth · seed paper</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={runDepth}
                  onChange={(e) => setRunDepth(e.target.checked)}
                />
                <span>on</span>
              </label>
            </div>
            <p className="hint">
              Papers that cite this work, inside your journal set. DOI or title.
            </p>
            <div className="row">
              <input
                className="field"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resolveSeed()}
                placeholder="10.25300/MISQ/2013/37.2.02"
              />
              <button className="btn ghost" onClick={resolveSeed}>
                Resolve
              </button>
            </div>
            {seedStatus.state === "loading" && (
              <p className="note">{seedStatus.msg}</p>
            )}
            {seedStatus.state === "error" && (
              <p className="note err">{seedStatus.msg}</p>
            )}
            {seed && (
              <div className="seedcard">
                <strong>{seed.title}</strong>
                <span>
                  {seed.authors.join(", ")}
                  {seed.year ? ` · ${seed.year}` : ""}
                </span>
              </div>
            )}
          </div>

          {/* keywords */}
          <div className="block">
            <div className="block-head">
              <span className="branch-dot breadth" />
              <h2>Breadth · keywords</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={runBreadth}
                  onChange={(e) => setRunBreadth(e.target.checked)}
                />
                <span>on</span>
              </label>
            </div>
            <p className="hint">
              Papers matching this phrase in title, abstract, or full text,
              inside the same journal set.
            </p>
            <input
              className="field"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="rumor misinformation"
            />
          </div>

          {/* years */}
          <div className="block">
            <h2>Window</h2>
            <div className="row years">
              <input
                className="field small"
                type="number"
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value)}
              />
              <span className="dash">to</span>
              <input
                className="field small"
                type="number"
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value)}
              />
            </div>
          </div>

          <button className="btn run" onClick={run} disabled={running}>
            {running ? "Searching both branches…" : "Run branching review"}
          </button>
          {error && <p className="note err">{error}</p>}
        </section>

        {/* ---------------- journals ---------------- */}
        <section className="panel journals">
          <div className="block-head">
            <h2>Journal set</h2>
            <span className="count-pill">{journals.length}</span>
          </div>

          <div className="presetbar">
            {ALL_GROUPS.map((k) => (
              <button key={k} className="chip" onClick={() => loadPreset(k)}>
                {k}
              </button>
            ))}
            <button className="chip solid" onClick={loadAllPresets}>
              All three
            </button>
          </div>

          <div className="row">
            <input
              className="field"
              value={jInput}
              onChange={(e) => setJInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchJournal()}
              placeholder="Add a journal by name…"
            />
            <button className="btn ghost" onClick={searchJournal}>
              {jLooking ? "…" : "Find"}
            </button>
          </div>

          {jMatches.length > 0 && (
            <ul className="matchlist">
              {jMatches.map((m) => (
                <li key={m.id}>
                  <button onClick={() => addJournal(m)}>
                    <strong>{m.name}</strong>
                    <span>
                      {(m.issn_l || (m.issns && m.issns[0]) || "no ISSN")} ·{" "}
                      {m.works.toLocaleString()} works
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="journal-scroll">
            {Object.entries(groupedJournals).map(([group, list]) => (
              <div key={group} className="jgroup">
                <div className="jgroup-label">{group}</div>
                {list.map((j) => (
                  <div key={j.issn} className="jrow">
                    <span className="jname">{j.name}</span>
                    <span className="jissn">{j.issn}</span>
                    <button
                      className="x"
                      onClick={() => removeJournal(j.issn)}
                      aria-label={`Remove ${j.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- results ---------------- */}
        <section className="panel results">
          {!results && !running && (
            <div className="empty">
              <div className="empty-diagram" aria-hidden="true">
                <div className="col">
                  <span className="lbl">depth</span>
                  <div className="stack d" />
                </div>
                <div className="conv">
                  <span className="lbl">core</span>
                  <div className="stack c" />
                </div>
                <div className="col">
                  <span className="lbl">breadth</span>
                  <div className="stack b" />
                </div>
              </div>
              <p>
                Set your seed, keywords, and journals, then run the review. The
                two branches and their convergent core appear here.
              </p>
            </div>
          )}

          {running && (
            <div className="empty">
              <div className="pulse" />
              <p>Querying OpenAlex across both branches…</p>
            </div>
          )}

          {results && (
            <>
              <div className="venn">
                <Stat
                  label="Depth only"
                  sub="cite seed, off-topic"
                  n={results.counts.depthOnly}
                  cls="depth"
                  active={tab === "depthOnly"}
                  onClick={() => setTab("depthOnly")}
                />
                <Stat
                  label="Convergent core"
                  sub="cite seed & on-topic"
                  n={results.counts.overlap}
                  cls="core"
                  active={tab === "overlap"}
                  onClick={() => setTab("overlap")}
                />
                <Stat
                  label="Breadth only"
                  sub="on-topic, cite elsewhere"
                  n={results.counts.breadthOnly}
                  cls="breadth"
                  active={tab === "breadthOnly"}
                  onClick={() => setTab("breadthOnly")}
                />
              </div>

              <div className="results-head">
                <div className="viewtabs">
                  <button
                    className={`vtab ${view === "papers" ? "on" : ""}`}
                    onClick={() => setView("papers")}
                  >
                    {activeList.length} paper{activeList.length === 1 ? "" : "s"}
                  </button>
                  <button
                    className={`vtab ${view === "breakdown" ? "on" : ""}`}
                    onClick={() => setView("breakdown")}
                  >
                    Topics & domains
                  </button>
                  <button
                    className={`vtab ${view === "synth" ? "on" : ""}`}
                    onClick={() => setView("synth")}
                  >
                    Synthesize ✦
                  </button>
                </div>
                <button className="btn ghost sm" onClick={exportCsv}>
                  Export CSV
                </button>
              </div>

              {view === "papers" && (
                <ul className="paperlist">
                  {activeList.map((w) => (
                    <li key={w.id} className="paper">
                      <a
                        href={w.doi || w.id}
                        target="_blank"
                        rel="noreferrer"
                        className="ptitle"
                      >
                        {w.title}
                      </a>
                      <div className="pmeta">
                        <span>{w.authors.slice(0, 4).join(", ")}</span>
                        {w.authors.length > 4 && <span> et al.</span>}
                      </div>
                      <div className="pmeta dim">
                        <span>{w.venue || "—"}</span>
                        <span>· {w.year || "—"}</span>
                        <span>· cited {w.cited_by}×</span>
                        {w.primaryTopic && (
                          <span className="topictag">{w.primaryTopic.name}</span>
                        )}
                      </div>
                    </li>
                  ))}
                  {activeList.length === 0 && (
                    <li className="paper empty-list">
                      Nothing in this group. Try widening the journal set, the
                      keywords, or the year window.
                    </li>
                  )}
                </ul>
              )}

              {view === "breakdown" && activeBreakdown && (
                <div className="breakdown">
                  {activeList.length === 0 ? (
                    <p className="empty-list">No papers in this group.</p>
                  ) : (
                    <>
                      <BreakBars
                        title="Research domains"
                        data={activeBreakdown.domains}
                        total={activeList.length}
                        cls="core"
                      />
                      <BreakBars
                        title="Fields"
                        data={activeBreakdown.fields}
                        total={activeList.length}
                        cls="depth"
                      />
                      <BreakBars
                        title="Subfields"
                        data={activeBreakdown.subfields}
                        total={activeList.length}
                        cls="breadth"
                      />
                      <div className="tagcloud">
                        <h4>Most common topics</h4>
                        <div className="tags">
                          {activeBreakdown.topics.map((t) => (
                            <span key={t.name} className="tag">
                              {t.name} <em>{t.count}</em>
                            </span>
                          ))}
                        </div>
                      </div>
                      {activeBreakdown.keywords.length > 0 && (
                        <div className="tagcloud">
                          <h4>Recurring keywords</h4>
                          <div className="tags">
                            {activeBreakdown.keywords.map((t) => (
                              <span key={t.name} className="tag ghost">
                                {t.name} <em>{t.count}</em>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {view === "synth" && (
                <div className="synth">
                  <div className="synth-intro">
                    <p>
                      Generate a themes-methods-gaps synthesis of the{" "}
                      <strong>{groupLabel}</strong> papers using your own
                      Anthropic API key. The key is used only for this request
                      and is never stored on the server.
                    </p>
                    <details className="howkey">
                      <summary>How to get an API key</summary>
                      <ol>
                        <li>
                          Go to{" "}
                          <a
                            href="https://console.anthropic.com/settings/keys"
                            target="_blank"
                            rel="noreferrer"
                          >
                            console.anthropic.com
                          </a>{" "}
                          and sign in.
                        </li>
                        <li>
                          Under <em>API Keys</em>, create a key. It starts with{" "}
                          <code>sk-ant-</code>.
                        </li>
                        <li>
                          You need a small amount of prepaid credit on the
                          account. A synthesis over ~50 abstracts costs a few
                          cents.
                        </li>
                        <li>Paste the key below. It stays in your browser.</li>
                      </ol>
                    </details>
                  </div>

                  <div className="keyrow">
                    <input
                      className="field"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-ant-…"
                      autoComplete="off"
                    />
                    <button
                      className="btn run synthbtn"
                      onClick={() => runSynthesis(activeList, groupLabel)}
                      disabled={synthBusy}
                    >
                      {synthBusy ? "Synthesizing…" : "Synthesize findings"}
                    </button>
                  </div>
                  <p className="microcopy">
                    Uses your credits · {activeList.length} papers · up to 60 per
                    run
                  </p>
                  {synthErr && <p className="note err">{synthErr}</p>}

                  {activeSynth && (
                    <div className="synth-out">
                      <div className="synth-meta">
                        {activeSynth.used.papers} papers ·{" "}
                        {activeSynth.used.input_tokens
                          ? `${activeSynth.used.input_tokens} in / ${activeSynth.used.output_tokens} out tokens`
                          : ""}
                      </div>
                      {activeSynth.synthesis.split("\n").map((line, i) =>
                        line.trim() ? (
                          <p key={i} className="synth-line">
                            {line}
                          </p>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="foot">
        Data from{" "}
        <a href="https://openalex.org" target="_blank" rel="noreferrer">
          OpenAlex
        </a>
        . This is a first-pass scan, not a substitute for a full PRISMA review —
        treat the results as a scaffold to screen by hand.
      </footer>
    </div>
  );
}

function Stat({ label, sub, n, cls, active, onClick }) {
  return (
    <button className={`stat ${cls} ${active ? "active" : ""}`} onClick={onClick}>
      <span className="statn">{n}</span>
      <span className="statl">{label}</span>
      <span className="stats">{sub}</span>
    </button>
  );
}

function BreakBars({ title, data, total, cls }) {
  if (!data || !data.length) return null;
  const max = data[0].count || 1;
  return (
    <div className="breakgroup">
      <h4>{title}</h4>
      {data.slice(0, 8).map((d) => (
        <div key={d.name} className="bar-row">
          <span className="bar-label">{d.name}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${cls}`}
              style={{ width: `${Math.max(6, (d.count / max) * 100)}%` }}
            />
          </div>
          <span className="bar-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}
