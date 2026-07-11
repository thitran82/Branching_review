// Preset journal baskets. ISSNs are the primary (issn_l) values used by OpenAlex.
// Users can edit any entry, remove journals, or add their own field's basket.
// The three groups mirror the manuscript's Study 2 scope:
//   - IS Senior Scholars' Basket of 11 (disciplinary core)
//   - ACM / IEEE computing venues (technical branch)
//   - High-impact IS-adjacent journals (ABDC A + SCImago Q1)

export const PRESETS = {
  "IS Basket of 11": [
    { name: "MIS Quarterly", issn: "0276-7783" },
    { name: "Information Systems Research", issn: "1047-7047" },
    { name: "Journal of Management Information Systems", issn: "0742-1222" },
    { name: "Journal of the Association for Information Systems", issn: "1536-9323" },
    { name: "European Journal of Information Systems", issn: "0960-085X" },
    { name: "Information Systems Journal", issn: "1350-1917" },
    { name: "Journal of Information Technology", issn: "0268-3962" },
    { name: "Journal of Strategic Information Systems", issn: "0963-8687" },
    { name: "Decision Support Systems", issn: "0167-9236" },
    { name: "Information & Management", issn: "0378-7206" },
    { name: "Information and Organization", issn: "1471-7727" },
  ],
  "ACM / IEEE computing": [
    { name: "ACM Computing Surveys", issn: "0360-0300" },
    { name: "IEEE Trans. Knowledge and Data Engineering", issn: "1041-4347" },
    { name: "IEEE Trans. Computational Social Systems", issn: "2329-924X" },
    { name: "IEEE Trans. Neural Networks and Learning Systems", issn: "2162-237X" },
    { name: "IEEE Trans. Big Data", issn: "2332-7790" },
    { name: "IEEE Trans. Network Science and Engineering", issn: "2327-4697" },
    { name: "IEEE Trans. Systems, Man, and Cybernetics: Systems", issn: "2168-2216" },
    { name: "IEEE Trans. Information Theory", issn: "0018-9448" },
    { name: "IEEE Trans. Signal Processing", issn: "1053-587X" },
    { name: "IEEE Trans. Fuzzy Systems", issn: "1063-6706" },
    { name: "IEEE Trans. Vehicular Technology", issn: "0018-9545" },
    { name: "IEEE Trans. Emerging Topics in Computing", issn: "2168-6750" },
    { name: "IEEE Trans. Control of Network Systems", issn: "2325-5870" },
    { name: "IEEE Trans. Network and Service Management", issn: "1932-4537" },
  ],
  "IS-adjacent (ABDC A + Q1)": [
    { name: "Computers in Human Behavior", issn: "0747-5632" },
    { name: "Government Information Quarterly", issn: "0740-624X" },
    { name: "Information Systems Frontiers", issn: "1387-3326" },
    { name: "Information Technology & People", issn: "0959-3845" },
  ],
};

// The seed used throughout the manuscript.
export const DEFAULT_SEED = {
  query: "10.25300/MISQ/2013/37.2.05",
  label: "Oh, Agrawal & Rao (2013) — MIS Quarterly",
};

export const DEFAULT_KEYWORDS = "rumor misinformation";
