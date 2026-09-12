// Journal presets for the branching-review artifact.
//
// IMPORTANT:
// - These ISSNs are used only to constrain the live OpenAlex discovery mode.
// - The historical review in the manuscript was executed in WoS + Scopus and
//   should be reproduced from the archived exports, not inferred from OpenAlex.
// - Information Systems Frontiers is retained because it is a known-positive
//   venue from the earlier validated corpus and contains Tran et al. (2020/2021).
//   Reconcile its status with the manuscript's current Appendix A before final submission.

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
    { name: "Communications of the ACM", issn: "0001-0782" },
    { name: "ACM Computing Surveys", issn: "0360-0300" },
    { name: "ACM Transactions on Information Systems", issn: "1046-8188" },
    { name: "ACM Transactions on Intelligent Systems and Technology", issn: "2157-6904" },
    { name: "ACM Transactions on Knowledge Discovery from Data", issn: "1556-4681" },
    { name: "ACM Transactions on Internet Technology", issn: "1533-5399" },
    { name: "ACM Transactions on Asian and Low-Resource Language Information Processing", issn: "2375-4699" },
    { name: "ACM Journal of Data and Information Quality", issn: "1936-1963" },
    { name: "IEEE/ACM Transactions on Networking", issn: "1063-6692" },
    { name: "IEEE Transactions on Knowledge and Data Engineering", issn: "1041-4347" },
    { name: "IEEE Transactions on Big Data", issn: "2332-7790" },
    { name: "IEEE Transactions on Network Science and Engineering", issn: "2327-4697" },
    { name: "IEEE Transactions on Systems, Man, and Cybernetics: Systems", issn: "2168-2216" },
    { name: "IEEE Transactions on Engineering Management", issn: "0018-9391" },
    { name: "IEEE Transactions on Emerging Topics in Computational Intelligence", issn: "2471-285X" },
    { name: "IEEE Transactions on Computational Social Systems", issn: "2329-924X" },
    { name: "IEEE Transactions on Cybernetics", issn: "2168-2267" },
  ],

  "Interdisciplinary / IS-adjacent": [
    { name: "Computers in Human Behavior", issn: "0747-5632" },
    { name: "Government Information Quarterly", issn: "0740-624X" },
    { name: "Internet Research", issn: "1066-2243" },
    { name: "Information Processing & Management", issn: "0306-4573" },
    { name: "Telematics and Informatics", issn: "0736-5853" },
    { name: "Information Systems Frontiers", issn: "1387-3326" },
  ],
};

// Correct seed: Oh, Agrawal & Rao (2013), MIS Quarterly 37(2), 407-426.
export const DEFAULT_SEED = {
  query: "10.25300/MISQ/2013/37.2.05",
  label: "Oh, Agrawal & Rao (2013) — MIS Quarterly",
};

// Live OpenAlex breadth rule syntax:
//   whitespace / AND = required concepts; | / OR = alternatives inside a concept.
// Example below means (rumor OR rumour) AND misinformation.
// Replace with the archived WoS/Scopus query terms when those exact strings are recovered.
export const DEFAULT_KEYWORDS = "rumor|rumour misinformation";
