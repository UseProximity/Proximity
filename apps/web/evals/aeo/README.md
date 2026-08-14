# AEO benchmark: does AI search recommend Proximity?

Tracks whether useproximity.org gets cited or recommended when assistants
answer WashU housing questions. Run it before and after content changes so
the effect of the /washu pages on LLM visibility is measurable.

## How to run (Claude Code, no API key)

In a Claude Code session in this repo, say:

> Run the AEO benchmark: for each prompt in apps/web/evals/aeo/prompts.mjs,
> run a web search phrased as that question and record (a) whether
> useproximity.org appears in the results or would plausibly be cited in an
> answer, (b) at what rank, (c) which competing domains dominate. Write the
> results as JSON to apps/web/evals/aeo/results/<YYYY-MM-DD>.json in the
> schema below, then print the comparison against the previous snapshot.

## Result schema

```json
{
  "runDate": "2026-08-12",
  "runner": "claude-code websearch",
  "results": [
    {
      "id": "find-apartments",
      "prompt": "help me find apartments near washu",
      "proximityCited": false,
      "proximityRank": null,
      "topDomains": ["wustl.edu", "apartments.com"],
      "notes": ""
    }
  ]
}
```

## Method notes and honest limits

- The runner approximates an assistant's retrieval with a web-search backend;
  it is a proxy, not a measurement of ChatGPT itself. Trends across runs
  matter more than any single number.
- Complementary manual check: ask the same prompts in ChatGPT and expand the
  "Searched the web" chip to see its actual queries and sources (Ben's
  captures from 2026-08-10 established the baseline pattern: wustl.edu's ARS
  pages, an Off-Campus Partners white label, dominate).
- Keep `prompts.mjs` stable; comparability beats coverage.
- `results/` is committed so history travels with the repo.
