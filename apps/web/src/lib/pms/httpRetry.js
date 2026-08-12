/*
 * fetch with timeout + backoff for PMS/Nango calls.
 *
 * Retries 429 and 5xx (and network errors) with exponential backoff, honoring
 * Retry-After when present. Never retries 4xx auth/validation errors — those
 * are real answers. Returns the Response; the caller decides how to parse.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url, options = {}, {
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseDelayMs = 1_000,
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.status !== 429 && res.status < 500) return res;

      lastError = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      if (attempt === retries) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : baseDelayMs * 2 ** attempt;
      await sleep(Math.min(delay, 60_000));
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}
