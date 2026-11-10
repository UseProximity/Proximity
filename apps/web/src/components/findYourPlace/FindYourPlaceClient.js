"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StepBasics from "./StepBasics";
import StepPreferences from "./StepPreferences";
import StepMatches, { MATCH_PANEL } from "./StepMatches";
import { ProgressBar, FooterButton, ChoiceDialog } from "./ui";
import { trackEvent, setListingSource } from "@/utils/analytics";
import {
  NO_PREFERENCE,
  QUESTION_COUNT,
  LEASE_OPTIONS,
  answeredCount,
  nextOccurrence,
} from "@/lib/findYourPlace/options";

const STORAGE_KEY = "prx_fyp_v1";
const EMPTY_ANSWERS = { group: null, budget: null, lease: null, moveIn: null, modes: [], commuteMax: null };
const SOURCE = "matchmaking";

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
    out.moveIn = value >= new Date().toISOString().slice(0, 7) ? value : nextOccurrence(Number(moveIn[2]));
  }
  return out;
}

export default function FindYourPlaceClient() {
  const router = useRouter();
  const { status } = useSession();
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
  // Bumped by Start over so page 1 remounts with its "Other" fields closed.
  const [round, setRound] = useState(0);
  const mainRef = useRef(null);
  // Where the page starts under the site header (and any environment banner),
  // so the panel can be sized to exactly the rest of the screen.
  const [topOffset, setTopOffset] = useState(104);

  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const el = mainRef.current;
      if (el) setTopOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
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
      setAnswers({ ...EMPTY_ANSWERS, ...(stored.answers ?? {}) });
      setText(stored.text ?? "");
      setChips(stored.chips ?? {});
      // Matches saved before the browse hand-off existed carry no `browse`,
      // which left the button reading "Browse All Listings". Drop them so the
      // next "Show My Matches" searches again.
      const saved = stored.results?.browse?.notApplied ? stored.results : null;
      setResults(saved);
      setStep(stored.step === 3 && !saved ? 2 : stored.step ?? 1);
    }
    setReady(true);
    trackEvent("Find Your Place Opened", { resumed: !!stored });
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, answers, text, chips, results }));
    } catch {
      // Private mode or a full store: the run just won't survive a reload.
    }
  }, [ready, step, answers, text, chips, results]);

  // A signed-in student starts from what their profile already says. Only on
  // an untouched form, and every answer stays one tap to change.
  useEffect(() => {
    if (!ready || !signedIn || prefilled) return;
    setPrefilled(true);
    if (answeredCount(answers) > 0 || results) return;
    fetch("/api/account/lease-preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((saved) => {
        if (!saved) return;
        const fromProfile = answersFromProfile(saved);
        if (Object.keys(fromProfile).length) {
          setAnswers((current) => (answeredCount(current) > 0 ? current : { ...current, ...fromProfile }));
        }
      })
      .catch(() => {});
  }, [ready, signedIn, prefilled, answers, results]);

  const goTo = (next) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // What a set of matches was found for. Going Back and forward again with
  // nothing changed shows the same matches instead of searching again (and
  // getting a different four).
  const keyOf = (input) => JSON.stringify([input.answers, input.text.trim(), input.chips]);

  const run = async (override = {}, { force = false } = {}) => {
    const input = { answers, text, chips, ...override };
    const payload = { ...input, sessionId: results?.sessionId ?? null };
    if (!force && results?.matches && results.key === keyOf(input)) {
      setError(null);
      goTo(3);
      return;
    }
    setError(null);
    setLoading(true);
    goTo(3);
    try {
      const res = await fetch("/api/find-your-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERRORS[data.error] ?? ERRORS.generic);
        return;
      }
      setResults({
        matches: data.matches ?? [],
        totalMatches: data.totalMatches ?? 0,
        sessionId: data.sessionId ?? null,
        key: keyOf(input),
        browse: data.browse ?? null,
      });
      trackEvent("Find Your Place Matches Shown", {
        count: data.matches?.length ?? 0,
        fits: data.totalMatches ?? 0,
        nearMisses: (data.matches ?? []).filter((m) => m.near_miss).length,
        wroteText: !!payload.text,
      });
    } catch {
      setError(ERRORS.generic);
    } finally {
      setLoading(false);
    }
  };

  // Wipe every answer and the saved matches, and go back to the first page.
  const startOver = () => {
    trackEvent("Find Your Place Started Over", { fromStep: step });
    setAnswers(EMPTY_ANSWERS);
    setText("");
    setChips({});
    setResults(null);
    setError(null);
    setRound((n) => n + 1);
    goTo(1);
  };

  const answered = answeredCount(answers);
  const canStartOver = step > 1 || answered > 0 || answers.modes.length > 0 || !!text || !!results;
  // Full as soon as the matches are asked for, not when they arrive.
  const progress = step === 1 ? (answered / QUESTION_COUNT) * QUESTIONS_FILL : step === 2 ? QUESTIONS_FILL : 1;

  const openListing = (match, position, tab) => {
    trackEvent(tab ? "Find Your Place Contact Clicked" : "Find Your Place Listing Clicked", { listingId: match.listing_id, position });
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
     * and, on a screen too short for a step, the panel's own body scrolls. The
     * height is a measured value, so it is the one inline style here.
     */
    <main
      ref={mainRef}
      className={`min-h-[480px] px-3 py-2 sm:px-6 sm:py-3 [@media(min-height:780px)]:sm:py-6 ${BACKDROP}`}
      style={{ height: `calc(100dvh - ${topOffset}px)` }}
    >
      <div
        className={`mx-auto flex h-full w-full flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white transition-[max-width] duration-300 ${
          step === 3 ? MATCH_PANEL : "max-w-[760px]"
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

        <div data-fyp-body className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-12 [@media(min-height:780px)]:sm:py-7">
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
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5">
          {step > 1 ? <FooterButton onClick={() => goTo(step - 1)}>Back</FooterButton> : <span />}
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
            router.push("/login?tab=signup&callbackUrl=/find-your-place");
          }}
        />
      )}
    </main>
  );
}
