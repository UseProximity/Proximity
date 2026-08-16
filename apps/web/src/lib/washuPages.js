/*
 * Registry for the /washu landing pages, mirroring lib/guides.js. Structure
 * and filters live here (code); the human-readable copy for each page lives in
 * src/content/washu/<slug>.json so the content-refresh workflow can edit copy
 * without ever touching code. Listing data on these pages is queried live at
 * render (ISR), never hard-coded.
 *
 * targetQueries feed the SEO measurement engine; they come from the Aug 2026
 * research sprint (Search Console export, autocomplete harvest, SERP gaps).
 */

export const washuPages = [
  {
    slug: "studio-apartments",
    kind: "beds",
    filter: { bedrooms: 0 },
    title: "Studio Apartments Near WashU | Proximity",
    h1: "Studio apartments near WashU",
    metaDescription:
      "Every studio apartment near WashU with rent, walk time to campus, and honest reviews from WashU students. Updated live from Proximity listings.",
    targetQueries: [
      "studio apartments near washu",
      "studio apartments st louis",
      "studio apartments university city",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["1-bedroom-apartments", "apartments-under-1000", "delmar-loop-apartments"],
  },
  {
    slug: "1-bedroom-apartments",
    kind: "beds",
    filter: { bedrooms: 1 },
    title: "1 Bedroom Apartments Near WashU | Proximity",
    h1: "1 bedroom apartments near WashU",
    metaDescription:
      "1 bedroom apartments near WashU with current rents, walk times to campus, and reviews from students who actually lived there.",
    targetQueries: [
      "1 bedroom apartments near washu",
      "one bedroom apartments near washu",
      "1 bedroom apartments university city",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["2-bedroom-apartments", "studio-apartments", "skinker-debaliviere-apartments"],
  },
  {
    slug: "2-bedroom-apartments",
    kind: "beds",
    filter: { bedrooms: 2 },
    title: "2 Bedroom Apartments Near WashU | Proximity",
    h1: "2 bedroom apartments near WashU",
    metaDescription:
      "2 bedroom apartments near WashU with real rents, per person costs, walk times to campus, and honest student reviews.",
    targetQueries: [
      "2 bedroom apartments near washu",
      "2 bedroom apartments university city",
      "washu 2 bedroom apartments",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["3-bedroom-apartments", "1-bedroom-apartments", "apartments-under-1500"],
  },
  {
    slug: "3-bedroom-apartments",
    kind: "beds",
    filter: { bedrooms: 3 },
    title: "3 Bedroom Apartments Near WashU | Proximity",
    h1: "3 bedroom apartments near WashU",
    metaDescription:
      "3 bedroom apartments near WashU for groups, with real rents, per person splits, walk times, and reviews from WashU students.",
    targetQueries: [
      "3 bedroom apartments near washu",
      "3 bedroom apartments university city",
      "washu group housing",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["2-bedroom-apartments", "apartments-under-1500", "university-city-apartments"],
  },
  {
    slug: "apartments-under-1000",
    kind: "price",
    filter: { maxPerPerson: 1000 },
    title: "Apartments Near WashU Under $1,000 Per Person | Proximity",
    h1: "Apartments near WashU under $1,000 per person",
    metaDescription:
      "Apartments near WashU where your share of rent stays under $1,000 a month. Real listings, walk times, and honest student reviews.",
    targetQueries: [
      "cheap apartments near washu",
      "apartments near washu under 1000",
      "cheap apartments university city",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["apartments-under-1500", "studio-apartments", "skinker-debaliviere-apartments"],
  },
  {
    slug: "apartments-under-1500",
    kind: "price",
    filter: { maxPerPerson: 1500 },
    title: "Apartments Near WashU Under $1,500 Per Person | Proximity",
    h1: "Apartments near WashU under $1,500 per person",
    metaDescription:
      "Apartments near WashU where your share of rent stays under $1,500 a month, with walk times to campus and reviews from WashU students.",
    targetQueries: [
      "apartments near washu under 1500",
      "washu apartments under 1500",
      "affordable apartments near washu",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["apartments-under-1000", "2-bedroom-apartments", "university-city-apartments"],
  },
  {
    slug: "university-city-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "university-city" },
    title: "University City Apartments for WashU Students | Proximity",
    h1: "University City apartments for WashU students",
    metaDescription:
      "Apartments in University City, St. Louis near WashU: real rents, walk times to campus and the Loop, and honest reviews from students.",
    targetQueries: [
      "university city apartments",
      "university city apartments for students",
      "u city apartments st louis",
      "apartments in university city mo",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["delmar-loop-apartments", "skinker-debaliviere-apartments", "apartments-under-1500"],
  },
  {
    slug: "delmar-loop-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "the-loop" },
    title: "Delmar Loop Apartments for WashU Students | Proximity",
    h1: "Delmar Loop apartments for WashU students",
    metaDescription:
      "Living on the Delmar Loop as a WashU student: current apartments, real rents, walk times to campus, and honest student reviews.",
    targetQueries: [
      "delmar loop apartments",
      "apartments on the loop st louis",
      "delmar loop apartments reviews",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["university-city-apartments", "skinker-debaliviere-apartments", "2-bedroom-apartments"],
  },
  {
    slug: "clayton-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "clayton" },
    title: "Clayton Apartments for WashU Students | Proximity",
    h1: "Clayton apartments for WashU students",
    metaDescription:
      "Apartments in Clayton, MO for WashU students: what they cost, how far campus is, and what students say about living there.",
    targetQueries: [
      "clayton mo apartments",
      "clayton apartments for students",
      "apartments near washu clayton",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["demun-apartments", "central-west-end-apartments", "apartments-under-1500"],
  },
  {
    slug: "central-west-end-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "central-west-end" },
    title: "Central West End Apartments for WashU Students | Proximity",
    h1: "Central West End apartments for WashU students",
    metaDescription:
      "CWE apartments for WashU students, including the med campus crowd: real rents, commute times, and honest student reviews.",
    targetQueries: [
      "central west end apartments",
      "cwe apartments st louis",
      "apartments near washu med school",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["clayton-apartments", "skinker-debaliviere-apartments", "1-bedroom-apartments"],
  },
  {
    slug: "demun-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "demun" },
    title: "DeMun Apartments for WashU Students | Proximity",
    h1: "DeMun apartments for WashU students",
    metaDescription:
      "Apartments in DeMun near WashU: quiet streets, coffee shops, real rents, and reviews from students who lived there.",
    targetQueries: ["demun apartments", "demun apartments clayton", "demun st louis"],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["clayton-apartments", "1-bedroom-apartments", "apartments-under-1500"],
  },
  {
    slug: "skinker-debaliviere-apartments",
    kind: "neighborhood",
    filter: { neighborhood: "skinker-debaliviere" },
    title: "Skinker-DeBaliviere Apartments for WashU Students | Proximity",
    h1: "Skinker-DeBaliviere apartments for WashU students",
    metaDescription:
      "Skinker-DeBaliviere apartments near WashU: the student blocks behind the Loop, real rents, walk times, and honest reviews.",
    targetQueries: [
      "skinker debaliviere apartments",
      "skinker debaliviere apartments for rent",
      "apartments behind the loop washu",
    ],
    datePublished: "2026-08-10",
    dateModified: "2026-08-10",
    related: ["delmar-loop-apartments", "university-city-apartments", "apartments-under-1000"],
  },
];

export function getWashuPage(slug) {
  return washuPages.find((p) => p.slug === slug) ?? null;
}
