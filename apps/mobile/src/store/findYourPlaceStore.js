// Find Your Place: the three-page search (answers, then anything else, then the
// matches). Ported from the website's apps/web/src/components/findYourPlace/
// FindYourPlaceClient.js, which holds the same rules; the questions and their
// validation come from @proximity/shared (findYourPlace/options.js).
//
// The app only runs it signed in (the screen shows the sign-in prompt
// otherwise), so the website's signed-out cap, sign-in wall and "add this search
// to your account" prompt have no counterpart here.
//
// The run on screen is saved to a small file per account, so it survives the app
// being closed, as the website keeps it in browser storage. A change of signed-in
// account (sign out, or another account) clears it, file included.
import { create } from "zustand";
import { File, Paths } from "expo-file-system";
import { NO_PREFERENCE, rollForward, sanitizeAnswers, answeredCount, standingChips } from "@proximity/shared";
import apiClient from "../lib/apiClient";
import { isNetworkError } from "../lib/apiError";
import { ERROR_MESSAGES } from "../lib/errorMessages";
import { useAuthStore } from "./authStore";

// The version of the "Browse All Matches" hand-off the server sends as
// `browse.version`. A copy of HANDOFF_VERSION in the web code's
// apps/web/src/lib/findYourPlace/browseHandoff.js: the two must change together.
const HANDOFF_VERSION = 4;

export const EMPTY_ANSWERS = { group: null, budget: null, lease: null, moveIn: null, modes: [], commuteMax: null };

const E = ERROR_MESSAGES.FIND_YOUR_PLACE;

// What a failed search shows, with what its button does ("retry" or "fix",
// which goes back to page 1). Signed in there is no search cap, so any 429 is the
// server being busy.
function errorFor(err) {
  if (isNetworkError(err)) return { ...E.OFFLINE, action: "retry" };
  if (err?.status === 400 && err.body?.error === "invalid") return { ...E.INVALID, action: "fix" };
  if (err?.status === 429) return { ...E.BUSY, action: "retry" };
  return { ...E.GENERIC, action: "retry" };
}

// What a set of matches was found for: going Back and forward again with nothing
// changed shows the same matches instead of searching again.
const keyOf = (input) => JSON.stringify([input.answers, input.text.trim(), input.chips]);

// Saved profile preferences (move-in month, lease length, beds) as page 1
// answers. Same rules as the website's answersFromProfile.
function answersFromProfile(saved) {
  const out = {};
  const beds = Array.isArray(saved?.beds) && saved.beds.length === 1 ? Number(saved.beds[0]) : null;
  if (Number.isFinite(beds) && beds >= 1) out.group = String(beds);
  const months = Array.isArray(saved?.months) && saved.months.length ? Number(saved.months[0]) : null;
  if (Number.isFinite(months) && months > 0) {
    out.lease = months <= 6 ? "semester" : months >= 8 && months <= 10 ? "academic" : months >= 11 && months <= 12 ? "full" : String(months);
  }
  const moveIn = /^(\d{4})-(\d{2})/.exec(saved?.moveIn ?? "");
  // A saved month that has already gone by means the next one.
  if (moveIn) out.moveIn = rollForward(`${moveIn[1]}-${moveIn[2]}`);
  // Only what the search would accept.
  const clean = sanitizeAnswers({ ...EMPTY_ANSWERS, ...out });
  return Object.fromEntries(Object.entries(out).filter(([k]) => clean[k] != null));
}

const fileFor = (userId) => new File(Paths.document, `find-your-place-${String(userId).replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

function deleteSaved(userId) {
  try {
    const file = fileFor(userId);
    if (file.exists) file.delete();
  } catch (err) {
    console.warn("findYourPlace: could not delete the saved run", err?.message);
  }
}

// Each search gets a number; a reply for any but the latest is dropped, so a slow
// older search cannot land over a newer one, over Start over or over another account.
let runCounter = 0;
let controller = null;
function cancelRun() {
  runCounter += 1;
  controller?.abort();
  controller = null;
}

const blank = {
  step: 1,
  answers: EMPTY_ANSWERS,
  text: "",
  chips: {},
  results: null, // { matches, totalMatches, sessionId, key, browse }
  loading: false,
  error: null,
  // Bumped by Start over so page 1 remounts with its "Other" fields closed.
  round: 0,
};

export const useFindYourPlaceStore = create((set, get) => ({
  ...blank,
  // The account the run on screen belongs to, once its saved run has been read.
  owner: null,

  // Reads this account's saved run (once), then prefills an untouched form from
  // the profile.
  load: async (userId) => {
    if (!userId || get().owner === userId) return;
    cancelRun();
    set({ ...blank, owner: userId });
    let stored = null;
    try {
      const file = fileFor(userId);
      if (file.exists) stored = JSON.parse(await file.text());
    } catch {
      stored = null;
    }
    if (get().owner !== userId) return;
    if (stored && typeof stored === "object") {
      const answers = { ...EMPTY_ANSWERS, ...(stored.answers ?? {}) };
      // A move-in month that has gone by since becomes the next one, and matches
      // found for the old month are dropped.
      const moveIn = answers.moveIn && answers.moveIn !== NO_PREFERENCE ? rollForward(answers.moveIn) : answers.moveIn;
      // So are matches saved with no Browse hand-off or an older one, so the next
      // "Show My Matches" searches again rather than opening Browse with outdated
      // filters. A newer one is kept: an installed app cannot know versions
      // released after it, and must not lose every saved run when web raises it.
      const version = stored.results?.browse?.version;
      const current = typeof version === "number" && version >= HANDOFF_VERSION;
      const results = moveIn === answers.moveIn && current ? stored.results : null;
      const step = [1, 2, 3].includes(stored.step) ? stored.step : 1;
      set({
        answers: { ...answers, moveIn },
        text: typeof stored.text === "string" ? stored.text : "",
        chips: stored.chips && typeof stored.chips === "object" ? stored.chips : {},
        results,
        step: step === 3 && !results ? 2 : step,
      });
    }
    const { answers, results } = get();
    if (answeredCount(answers) > 0 || results) return;
    try {
      const saved = await apiClient.user.getLeasePreferences();
      const fromProfile = answersFromProfile(saved);
      if (get().owner !== userId || !Object.keys(fromProfile).length) return;
      // Only while the form is still untouched.
      if (answeredCount(get().answers) === 0) set({ answers: { ...get().answers, ...fromProfile } });
    } catch {
      // Prefill is a convenience: without it the form starts empty.
    }
  },

  setStep: (step) => set({ step }),
  setAnswers: (answers) => set({ answers }),
  setPreferences: (patch) => set(patch),
  clearError: () => set({ error: null }),

  // Wipe every answer and the saved matches, and go back to the first page.
  startOver: () => {
    cancelRun();
    set((s) => ({ ...blank, round: s.round + 1 }));
  },

  // `force` is "Try again": it searches even when nothing changed, and the
  // request says it is a retry (the server records it on failed searches).
  run: async (override = {}, { force = false } = {}) => {
    const s = get();
    const merged = { answers: s.answers, text: s.text, chips: s.chips, ...override };
    // Only the ideas whose sentence still stands in the box.
    const input = { ...merged, chips: standingChips(merged.text, merged.chips) };
    if (!force && s.results?.matches && s.results.key === keyOf(input)) {
      set({ error: null, step: 3 });
      return;
    }
    cancelRun();
    const runId = runCounter;
    controller = new AbortController();
    const { signal } = controller;
    set({ error: null, loading: true, step: 3 });
    try {
      const data = await apiClient.findYourPlace.run(
        { ...input, sessionId: s.results?.sessionId ?? null, retry: force },
        { signal }
      );
      if (runId !== runCounter) return;
      set({
        results: {
          matches: data.matches ?? [],
          totalMatches: data.totalMatches ?? 0,
          sessionId: data.sessionId ?? null,
          key: keyOf(input),
          browse: data.browse ?? null,
        },
      });
    } catch (err) {
      if (runId !== runCounter || signal.aborted) return;
      // An expired session signs the user out (the api client does that), which
      // clears this run, so there is nothing to show here.
      if (err?.status === 401) return;
      console.error("[findYourPlace] search failed:", err?.status ?? err?.message);
      set({ error: errorFor(err) });
    } finally {
      if (runId === runCounter) set({ loading: false });
    }
  },
}));

// Save the run whenever it changes, a moment after typing stops.
let saveTimer = null;
useFindYourPlaceStore.subscribe((state, previous) => {
  const { owner, step, answers, text, chips, results } = state;
  if (!owner || owner !== previous.owner) return;
  if (step === previous.step && answers === previous.answers && text === previous.text && chips === previous.chips && results === previous.results) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (useFindYourPlaceStore.getState().owner !== owner) return;
    try {
      const file = fileFor(owner);
      if (!file.exists) file.create();
      file.write(JSON.stringify({ step, answers, text, chips, results }));
    } catch (err) {
      console.warn("findYourPlace: could not save the run", err?.message);
    }
  }, 300);
});

// A different signed-in account (sign out, sign in, or a direct switch) ends the
// previous account's search and clears its run, saved file included. Token
// refreshes and profile edits keep the same id, so they change nothing.
useAuthStore.subscribe((state, previous) => {
  const before = previous.user?.id;
  if (state.user?.id === before) return;
  cancelRun();
  clearTimeout(saveTimer);
  if (before) deleteSaved(before);
  useFindYourPlaceStore.setState({ ...blank, owner: null });
});
