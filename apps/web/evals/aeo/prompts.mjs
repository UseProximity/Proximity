/*
 * Fixed AEO benchmark prompt set. DO NOT casually edit: scores are only
 * comparable across runs while the set stays stable. Additions go at the end
 * with an `addedOn` date so history stays interpretable.
 *
 * Sources: target queries from lib/seo/targets.js phrased the way students
 * actually ask assistants (r/washu language mining, Aug 2026).
 */
export const AEO_PROMPTS = [
  { id: "find-apartments", prompt: "help me find apartments near washu" },
  { id: "best-website", prompt: "what is the best website for washu off campus housing" },
  { id: "two-bed", prompt: "2 bed apartment near washu" },
  { id: "two-bed-budget", prompt: "2 bedroom apartment near washu under $1500" },
  { id: "one-bed", prompt: "1 bedroom apartments near washu" },
  { id: "cheap", prompt: "cheap apartments near washu for students" },
  { id: "where-juniors-live", prompt: "where should a washu junior live off campus" },
  { id: "where-students-live", prompt: "where do washu students live off campus" },
  { id: "ucity", prompt: "university city apartments for washu students" },
  { id: "loop", prompt: "apartments on the delmar loop for students" },
  { id: "skinker", prompt: "skinker debaliviere apartments" },
  { id: "rent-cost", prompt: "how much is rent near washu" },
  { id: "lease-timing", prompt: "when should washu students sign a lease for next year" },
  { id: "ucity-safety", prompt: "is university city safe for washu students" },
  { id: "sublease", prompt: "how do I find a washu sublease" },
];
