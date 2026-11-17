"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StepBasics from "./StepBasics";
import StepPreferences from "./StepPreferences";
import StepMatches, { MATCH_PANEL } from "./StepMatches";
import { ProgressBar, FooterButton, ChoiceDialog } from "./ui";
import { HANDOFF_VERSION } from "@/lib/findYourPlace/browseHandoff";
import { trackEvent, recordFyp, setListingSource, rememberMatchesShown, getPreviousPath } from "@/utils/analytics";
import {
  NO_PREFERENCE,
  QUESTION_COUNT,
  LEASE_OPTIONS,
  GROUP_OPTIONS,
  BIG_GROUP_MIN,
  answeredCount,
  sanitizeAnswers,
  standingChips,
  rollForward,
} from "@/lib/findYourPlace/options";

const STORAGE_KEY = "prx_fyp_v1";
// Set when the student heads to sign-in from this page (the "save your
// matches" wall, or the search cap), naming the search on screen. Coming back
// signed in with it set claims that search straight away; any other sign-in on
// this browser is asked first.
const CLAIM_KEY = "prx_fyp_claim";
const CLAIM_WINDOW_MS = 60 * 60 * 1000;
const EMPTY_ANSWERS = { group: null, budget: null, lease: null, moveIn: null, modes: [], commuteMax: null };
const SOURCE = "matchmaking";

// Each page by name, as the analytics page reports where people stop. Page 3
// before any match is on screen is "loading" (a search takes several seconds)
// or "error" (it failed), so leaving there is not read as leaving the matches.
const STAGES = { 1: "basics", 2: "preferences", 3: "matches" };
const stageOf = (step, loading, error) => (step === 3 && loading ? "loading" : step === 3 && error ? "error" : STAGES[step]);

// The five questions fill the bar to here; it completes on "Show My Matches".
const QUESTIONS_FILL = 0.8;

const ERRORS = {
  cap: {
    title: "You've run a lot of searches",
    body: "Sign in (it's free) to keep refining your matches.",
    signIn: true,
  },
  busy: {
    title: "We're getting a lot of searches right now",
    body: "Give it a minute and try again.",
    retry: true,
  },
  invalid: {
    title: "Some of your answers need another look",
    body: "Go back to the first page and check them, then search again.",
    fixAnswers: true,
  },
  generic: {
    title: "Something went wrong finding your matches",
    body: "Your answers are saved. Try again in a moment.",
    retry: true,
  },
};

function readStored() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/*
 * Who a stored run belongs to: a short hash of the signed-in account's email,
 * or null for a run made signed out. Only compared, never sent anywhere, and
 * hashed so the browser's storage does not hold the address.
 */
function ownerTag(email) {
  if (!email) return null;
  let h = 5381;
  for (const c of email.toLowerCase()) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function readClaimIntent() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CLAIM_KEY) ?? "null");
    window.localStorage.removeItem(CLAIM_KEY);
    return raw && Date.now() - raw.at < CLAIM_WINDOW_MS ? { sessionId: raw.sessionId ?? null } : null;
  } catch {
    return null;
  }
}

function writeClaimIntent(sessionId) {
  try {
    window.localStorage.setItem(CLAIM_KEY, JSON.stringify({ sessionId: sessionId ?? null, at: Date.now() }));
  } catch {
    // Without storage the student is simply asked on the way back.
  }
}

// Anything worth keeping or asking about in a run.
const hasContent = (a, text, results) =>
  answeredCount(a) > 0 || (a.modes ?? []).length > 0 || !!text?.trim() || !!results;

// Saved profile preferences (move-in month, lease length, beds) as page 1 answers.
function answersFromProfile(saved) {
  const out = {};
  const beds = Array.isArray(saved?.beds) && saved.beds.length === 1 ? Number(saved.beds[0]) : null;
  if (Number.isFinite(beds) && beds >= 1) out.group = String(beds);
  const months = Array.isArray(saved?.months) && saved.months.length ? Number(saved.months[0]) : null;
  if (Number.isFinite(months) && months > 0) {
    out.lease = months <= 6 ? "semester" : months >= 8 && months <= 10 ? "academic" : months >= 11 && months <= 12 ? "full" : String(months);
  }
  const moveIn = /^(\d{4})-(\d{2})/.exec(saved?.moveIn ?? "");
  if (moveIn) {
    const value = `${moveIn[1]}-${moveIn[2]}`;
    // A saved month that has already gone by means the next one.
    out.moveIn = rollForward(value);
  }
  // Only what the search would accept: a 30 month lease or a 14 bedroom
  // profile is left for the student to answer instead.
  const clean = sanitizeAnswers({ ...EMPTY_ANSWERS, ...out });
  return Object.fromEntries(Object.entries(out).filter(([k]) => clean[k] != null));
}

export default function FindYourPlaceClient() {
  const router = useRouter();
  const { status, data: session } = useSession();
  const signedIn = status === "authenticated";

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [text, setText] = useState("");
  const [chips, setChips] = useState({});
  const [results, setResults] = useState(null); // { matches, totalMatches, sessionId }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wall, setWall] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  // Who the run on screen belongs to (ownerTag), and whether that has been
  // settled for this visit: a run left by someone else is never shown as yours.
  const [owner, setOwner] = useState(null);
  const [settled, setSettled] = useState(false);
  // A signed-out run found on sign-in that did not come from this page's own
  // sign-in link: asked about before it joins the account.
  const [askClaim, setAskClaim] = useState(false);
  // Each search gets a number; a reply for any but the latest is dropped, so a
  // slow older search cannot land over a newer one or over Start over.
  const runIdRef = useRef(0);
  const abortRef = useRef(null);
  // Bumped by Start over so page 1 remounts with its "Other" fields closed.
  const [round, setRound] = useState(0);
  const mainRef = useRef(null);
  // Arrived with the group already picked in the homepage popup.
  const fromPopupRef = useRef(false);
  // Whether this browser held a run before the popup's answer went in: the
  // popup answer alone was just given by whoever is here now (PR 447 review).
  const storedContentRef = useRef(false);
  const openedRef = useRef(false);

  // Where the page starts under the site header (and any environment banner),
  // so the panel can be sized to exactly the rest of the screen. The measured
  // value goes into a CSS variable that the main area's Tailwind height reads.
  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const el = mainRef.current;
      if (el) el.style.setProperty("--fyp-top", `${Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ready]);

  // Restore an in-progress or finished run (also how the matches survive the
  // trip to the sign-in page and back).
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      const storedAnswers = { ...EMPTY_ANSWERS, ...(stored.answers ?? {}) };
      // A move-in month that has gone by since (August picked last summer)
      // becomes the next one, and matches found for the old month are dropped.
      const moveIn = storedAnswers.moveIn && storedAnswers.moveIn !== NO_PREFERENCE ? rollForward(storedAnswers.moveIn) : storedAnswers.moveIn;
      const rolled = moveIn !== storedAnswers.moveIn;
      setAnswers({ ...storedAnswers, moveIn });
      storedContentRef.current = hasContent(storedAnswers, stored.text ?? "", stored.results ?? null);
      setText(stored.text ?? "");
      setChips(stored.chips ?? {});
      setOwner(stored.owner ?? null);
      // Matches saved with an older browse hand-off (or none) would open
      // browse with filters missing. Drop them so the next "Show My Matches"
      // searches again.
      const saved = !rolled && stored.results?.browse?.version === HANDOFF_VERSION ? stored.results : null;
      setResults(saved);
      // Back to matches already found: leaving now is not dropping out.
      if (saved) shownRef.current = true;
      setStep(stored.step === 3 && !saved ? 2 : stored.step ?? 1);
    }
    // A group size picked in the homepage popup (?group=2): that answer goes
    // in, on page 1, and anything else saved on this browser stays.
    const params = new URLSearchParams(window.location.search);
    // "5+" is the same as tapping 5+ on page 1: 5, with the exact number open.
    const picked = params.get("group");
    const group = picked === "5+" ? String(BIG_GROUP_MIN) : picked;
    if (GROUP_OPTIONS.includes(picked)) {
      fromPopupRef.current = true;
      setAnswers((current) => ({ ...current, group }));
      setStep(1);
      params.delete("group");
      const qs = params.toString();
      window.history.replaceState(null, "", `/find-your-place${qs ? `?${qs}` : ""}`);
    }
    setReady(true);
    trackEvent("Find Your Place Opened", { resumed: !!stored, from: getPreviousPath("/find-your-place") });
    // Once per page view: React's development double mount runs this twice.
    if (!openedRef.current) recordFyp("opened", { resumed: !!stored, fromPopup: fromPopupRef.current });
    openedRef.current = true;
  }, []);

  /*
   * Leaving before any matches were shown on this visit: which page they were
   * on (the old chat's "Proxy Chat Exited"). Fired once, on the tab closing,
   * hiding into another app, or navigating away inside the site.
   */
  // The latest of each, for the leave handler set up once below.
  const stepRef = useRef(step);
  stepRef.current = step;
  const stageRef = useRef(STAGES[step]);
  stageRef.current = stageOf(step, loading, error);
  const answeredRef = useRef(0);
  answeredRef.current = answeredCount(answers);
  const shownRef = useRef(false);
  const leaveTimer = useRef(null);
  useEffect(() => {
    // React's development double mount unmounts and remounts at once: a leave
    // scheduled by that unmount is cancelled here, so only a real one is sent.
    clearTimeout(leaveTimer.current);
    let sent = false;
    const leave = () => {
      if (sent || shownRef.current) return;
      sent = true;
      const stage = stageRef.current;
      trackEvent("Find Your Place Exited", { stage });
      // How many of page 1's questions were answered, for which one loses people.
      recordFyp("exited", stepRef.current === 1 ? { stage, answered: answeredRef.current } : { stage });
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leaveTimer.current = setTimeout(leave, 0);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, answers, text, chips, results, owner }));
    } catch {
      // Private mode or a full store: the run just won't survive a reload.
    }
  }, [ready, step, answers, text, chips, results, owner]);

  // Clear the page without counting it as the student starting over.
  const wipe = () => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    setAnswers(EMPTY_ANSWERS);
    setText("");
    setChips({});
    setResults(null);
    setError(null);
    setLoading(false);
    setRound((n) => n + 1);
    setStep(1);
  };

  /*
   * Whose run is this? Settled once per visit, as soon as the sign-in state is
   * known (Wyatt's shared-computer rule, the same one the old chat had):
   *   - a run saved by an account, now signed out or signed in as someone
   *     else, is not theirs: the page starts clean;
   *   - a run made signed out, now signed in: claimed straight away only when
   *     they came back from this page's own sign-in link, otherwise asked;
   *   - anything else carries on as it is.
   */
  const viewer = signedIn ? ownerTag(session?.user?.email) : null;
  useEffect(() => {
    if (!ready || settled || status === "loading") return;
    setSettled(true);
    const intent = readClaimIntent();
    if (owner && owner !== viewer) {
      wipe();
      setOwner(viewer);
      return;
    }
    if (!owner && viewer) {
      // A signed-in student's own tap in the homepage popup is not a run
      // someone else left: only what was stored before it can be.
      const leftBefore = fromPopupRef.current ? storedContentRef.current : hasContent(answers, text, results);
      if (!leftBefore) {
        setOwner(viewer);
      } else if (intent && intent.sessionId === (results?.sessionId ?? null)) {
        claimRun();
      } else {
        setAskClaim(true);
      }
    }
  }, [ready, settled, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Take the signed-out run into the account: the page's copy now, the stored
  // search (if any) on the server, where it checks the run was this browser's.
  function claimRun() {
    setAskClaim(false);
    setOwner(viewer);
    const sessionId = results?.sessionId;
    if (!sessionId || results?.owned) return;
    fetch("/api/find-your-place", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.claimed) trackEvent("Find Your Place Matches Claimed");
        // Claimed now, or already someone's: either way, nothing more to do.
        setResults((r) => (r && r.sessionId === sessionId ? { ...r, owned: true } : r));
      })
      .catch(() => {});
  }

  // A signed-in student starts from what their profile already says. Only on
  // an untouched form, and every answer stays one tap to change.
  useEffect(() => {
    if (!ready || !settled || askClaim || !signedIn || prefilled) return;
    setPrefilled(true);
    // The popup's group answer alone still counts as an untouched form; the
    // profile fills the rest and never replaces that answer.
    const own = fromPopupRef.current ? 1 : 0;
    if (answeredCount(answers) > own || results) return;
    fetch("/api/account/lease-preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((saved) => {
        if (!saved) return;
        const fromProfile = answersFromProfile(saved);
        if (fromPopupRef.current) delete fromProfile.group;
        if (Object.keys(fromProfile).length) {
          setAnswers((current) => (answeredCount(current) > own ? current : { ...current, ...fromProfile }));
        }
      })
      .catch(() => {});
  }, [ready, settled, askClaim, signedIn, prefilled, answers, results]);

  const goTo = (next) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // What a set of matches was found for. Going Back and forward again with
  // nothing changed shows the same matches instead of searching again (and
  // getting a different four).
  const keyOf = (input) => JSON.stringify([input.answers, input.text.trim(), input.chips]);

  const run = async (override = {}, { force = false } = {}) => {
    const merged = { answers, text, chips, ...override };
    // Only the ideas whose sentence still stands in the box: one the student
    // deleted is not a preference any more.
    const input = { ...merged, chips: standingChips(merged.text, merged.chips) };
    const payload = { ...input, sessionId: results?.sessionId ?? null, fromPopup: fromPopupRef.current, retry: force };
    if (!force && results?.matches && results.key === keyOf(input)) {
      setError(null);
      goTo(3);
      return;
    }
    const runId = ++runIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => runId === runIdRef.current;
    setError(null);
    setLoading(true);
    goTo(3);
    try {
      const res = await fetch("/api/find-your-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!current()) return;
      if (!res.ok) {
        setError(ERRORS[data.error] ?? ERRORS.generic);
        return;
      }
      setResults({
        matches: data.matches ?? [],
        totalMatches: data.totalMatches ?? 0,
        sessionId: data.sessionId ?? null,
        // Run signed in: the search already belongs to the account.
        owned: !!data.signedIn,
        key: keyOf(input),
        browse: data.browse ?? null,
      });
      shownRef.current = true;
      rememberMatchesShown((data.matches ?? []).map((m) => m.listing_id));
      trackEvent("Find Your Place Matches Shown", {
        count: data.matches?.length ?? 0,
        fits: data.totalMatches ?? 0,
        nearMisses: (data.matches ?? []).filter((m) => m.near_miss).length,
        wroteText: !!payload.text,
      });
    } catch {
      if (current()) setError(ERRORS.generic);
    } finally {
      if (current()) setLoading(false);
    }
  };

  // Wipe every answer and the saved matches, and go back to the first page.
  const startOver = () => {
    const stage = stageOf(step, loading, error);
    trackEvent("Find Your Place Started Over", { stage });
    recordFyp("started_over", { stage });
    wipe();
    goTo(1);
  };

  const answered = answeredCount(answers);
  const canStartOver = step > 1 || answered > 0 || answers.modes.length > 0 || !!text || !!results;
  // Full as soon as the matches are asked for, not when they arrive.
  const progress = step === 1 ? (answered / QUESTION_COUNT) * QUESTIONS_FILL : step === 2 ? QUESTIONS_FILL : 1;

  const openListing = (match, position, tab) => {
    trackEvent(tab ? "Find Your Place Contact Clicked" : "Find Your Place Listing Clicked", {
      listingId: match.listing_id,
      position,
      intention: match.near_miss ? "Close match" : "Top match",
    });
    setListingSource(match.listing_id, SOURCE);
    // The listing's panel on the browse page, in a new tab, so the matches stay
    // open behind it (Wyatt, 2026-11-10). `src=matchmaking` is the value the
    // browse page attributes opens, saves and contacts to this flow with.
    window.open(
      `/browse?panel=${match.listing_id}&src=matchmaking${tab ? `&listingTab=${tab}` : ""}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const BACKDROP = "bg-[#f9f9f9] bg-[url('/assets/find-your-place-bg.svg')]";
  if (!ready) return <div className={`min-h-[80vh] ${BACKDROP}`} />;

  return (
    /*
     * The panel fills the screen under the header and never makes the page
     * scroll (Wyatt, 2026-11-10): the main area is exactly the leftover height
     * and, on a screen too short for a step, the panel's own body scrolls.
     * --fyp-top is the measured top of this area (see the effect above).
     */
    <main
      ref={mainRef}
      className={`h-[calc(100dvh-var(--fyp-top,104px))] min-h-[480px] px-3 py-2 sm:px-6 sm:py-3 [@media(min-height:780px)]:sm:py-6 ${BACKDROP}`}
    >
      <div
        className={`mx-auto flex w-full flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white transition-[max-width] duration-300 ${
          // Pages 1 and 2 end where their questions end (Wyatt, 2026-11-16);
          // only the matches fill the screen. All stay within it.
          step === 3 ? `h-full ${MATCH_PANEL}` : "max-h-full max-w-[760px]"
        }`}
      >
        <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-2.5 sm:px-8">
          <div className="min-w-0 flex-1">
            <ProgressBar value={progress} />
          </div>
          {/* Always in the same place; only live once there is something to clear. */}
          <button
            type="button"
            onClick={startOver}
            disabled={!canStartOver}
            className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-red-600 disabled:invisible"
          >
            Start over
          </button>
        </div>

        <div data-fyp-body className={`min-h-0 overflow-y-auto ${step === 3 ? "flex-1" : "flex-initial"} px-5 py-3 sm:px-12 [@media(min-height:780px)]:sm:py-7`}>
          {step === 1 && (
            <StepBasics
              key={round}
              answers={answers}
              onChange={setAnswers}
            />
          )}
          {step === 2 && (
            <StepPreferences
              text={text}
              chips={chips}
              onChange={(patch) => {
                if (patch.text !== undefined) setText(patch.text);
                if (patch.chips !== undefined) setChips(patch.chips);
              }}
              onSkip={() => {
                trackEvent("Find Your Place Preferences Skipped");
                run({ text: "", chips: {} });
              }}
            />
          )}
          {step === 3 && (
            <StepMatches
              loading={loading}
              error={error}
              matches={results?.matches ?? []}
              browse={results?.browse ?? null}
              signedIn={signedIn}
              onOpen={(m, i) => openListing(m, i)}
              onContact={(m, i) => openListing(m, i, "contact")}
              onLocked={(m, i) => {
                trackEvent("Find Your Place Wall Shown", { listingId: m.listing_id, position: i });
                setWall(true);
              }}
              onRetry={() => run({}, { force: true })}
              onFixAnswers={() => {
                setError(null);
                goTo(1);
              }}
              onSignIn={() => {
                // The search cap's Sign in: the one sign-up moment besides the wall.
                trackEvent("Find Your Place Cap Sign In Clicked");
                recordFyp("cap_sign_in");
                writeClaimIntent(results?.sessionId);
              }}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5">
          {step > 1 ? (
            <FooterButton
              onClick={() => {
                // Back from the matches to change answers (the old chat's "Answer Edited").
                if (step === 3) {
                  const stage = stageOf(step, loading, error);
                  trackEvent("Find Your Place Preferences Edited", { stage });
                  recordFyp("preferences_edited", { stage });
                }
                goTo(step - 1);
              }}
            >
              {step === 3 ? "Edit Preferences" : "Back"}
            </FooterButton>
          ) : (
            <span />
          )}
          {step === 1 && (
            <FooterButton
              primary
              disabled={answered < QUESTION_COUNT}
              onClick={() => {
                trackEvent("Find Your Place Basics Done", {
                  group: answers.group,
                  budget: answers.budget === NO_PREFERENCE ? null : answers.budget,
                  lease: LEASE_OPTIONS.some((o) => o.id === answers.lease) ? answers.lease : answers.lease === NO_PREFERENCE ? null : "other",
                  modes: answers.modes.join(","),
                });
                goTo(2);
              }}
            >
              Next
            </FooterButton>
          )}
          {step === 2 && (
            <FooterButton primary onClick={() => run()}>
              Show My Matches
            </FooterButton>
          )}
        </div>
      </div>

      {wall && (
        <ChoiceDialog
          title="Want to save your matches?"
          body="You'll need to sign in or sign up first."
          quietLabel="Not now"
          onQuiet={() => setWall(false)}
          primaryLabel="Save My Matches"
          onPrimary={() => {
            trackEvent("Find Your Place Wall Clicked");
            writeClaimIntent(results?.sessionId);
            router.push("/login?tab=signup&callbackUrl=/find-your-place");
          }}
        />
      )}
      {askClaim && (
        <ChoiceDialog
          title="Add this search to your account?"
          body="A search was started on this browser before you signed in. If it was yours, we'll keep it with your account."
          quietLabel="Not mine"
          onQuiet={() => {
            trackEvent("Find Your Place Claim Declined");
            setAskClaim(false);
            // The group size they just tapped in the homepage popup is theirs:
            // it stays when someone else's run is cleared away.
            const popupGroup = fromPopupRef.current ? answers.group : null;
            wipe();
            if (popupGroup) setAnswers({ ...EMPTY_ANSWERS, group: popupGroup });
            setOwner(viewer);
          }}
          primaryLabel="Add to My Account"
          onPrimary={claimRun}
        />
      )}
    </main>
  );
}
