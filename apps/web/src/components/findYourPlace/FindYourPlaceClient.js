"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StepBasics from "./StepBasics";
import StepPreferences from "./StepPreferences";
import StepMatches from "./StepMatches";
import { ProgressBar, FooterButton, ChoiceDialog } from "./ui";
import { trackEvent, setListingSource } from "@/utils/analytics";
import {
  NO_PREFERENCE,
  QUESTION_COUNT,
  PROMPTS_VISIBLE_AT_START,
  LEASE_OPTIONS,
  answeredCount,
  nextOccurrence,
} from "@/lib/findYourPlace/options";

const STORAGE_KEY = "prx_fyp_v1";
const EMPTY_ANSWERS = { group: null, budget: null, lease: null, moveIn: null, modes: [], commuteMax: null };
const SOURCE = "find-your-place";

// The five questions fill the bar to here; it completes when the matches show.
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
  const pathname = usePathname();
  const { status } = useSession();
  const signedIn = status === "authenticated";

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [text, setText] = useState("");
  const [chips, setChips] = useState({});
  const [visible, setVisible] = useState(PROMPTS_VISIBLE_AT_START);
  const [results, setResults] = useState(null); // { matches, totalMatches, sessionId }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wall, setWall] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const topRef = useRef(null);

  // Restore an in-progress or finished run (also how the matches survive the
  // trip to the sign-in page and back).
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setAnswers({ ...EMPTY_ANSWERS, ...(stored.answers ?? {}) });
      setText(stored.text ?? "");
      setChips(stored.chips ?? {});
      setVisible(stored.visible ?? PROMPTS_VISIBLE_AT_START);
      setResults(stored.results ?? null);
      setStep(stored.step === 3 && !stored.results ? 2 : stored.step ?? 1);
    }
    setReady(true);
    trackEvent("Find Your Place Opened", { resumed: !!stored });
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, answers, text, chips, visible, results }));
    } catch {
      // Private mode or a full store: the run just won't survive a reload.
    }
  }, [ready, step, answers, text, chips, visible, results]);

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
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const run = async (override = {}) => {
    const payload = { answers, text, chips, ...override, sessionId: results?.sessionId ?? null };
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
      setResults({ matches: data.matches ?? [], totalMatches: data.totalMatches ?? 0, sessionId: data.sessionId ?? null });
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

  const answered = answeredCount(answers);
  const progress = step === 1 ? (answered / QUESTION_COUNT) * QUESTIONS_FILL : step === 2 ? QUESTIONS_FILL : loading || error ? QUESTIONS_FILL : 1;

  const openListing = (match, position, tab) => {
    trackEvent(tab ? "Find Your Place Contact Clicked" : "Find Your Place Listing Clicked", { listingId: match.listing_id, position });
    setListingSource(match.listing_id, SOURCE);
    router.push(`${pathname}?listing=${match.listing_id}${tab ? `&listingTab=${tab}` : ""}`, { scroll: false });
  };

  if (!ready) return <div className="min-h-[70vh] bg-gray-50" />;

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-gray-50 px-3 py-8 sm:px-6 sm:py-14">
      <div ref={topRef} className="mx-auto flex min-h-[640px] w-full max-w-[760px] scroll-mt-24 flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4 sm:px-8">
          <ProgressBar value={progress} />
        </div>

        <div className="flex-1 px-5 py-8 sm:px-12 sm:py-12">
          {step === 1 && (
            <StepBasics
              answers={answers}
              onChange={(next) => {
                setAnswers(next);
                // A changed answer makes the old matches stale.
                if (results) setResults((r) => (r ? { ...r, matches: null } : r));
              }}
            />
          )}
          {step === 2 && (
            <StepPreferences
              text={text}
              chips={chips}
              visible={visible}
              onChange={(patch) => {
                if (patch.text !== undefined) setText(patch.text);
                if (patch.chips !== undefined) setChips(patch.chips);
                if (patch.visible !== undefined) setVisible(patch.visible);
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
              totalMatches={results?.totalMatches ?? 0}
              signedIn={signedIn}
              onOpen={(m, i) => openListing(m, i)}
              onContact={(m, i) => openListing(m, i, "contact")}
              onLocked={(m, i) => {
                trackEvent("Find Your Place Wall Shown", { listingId: m.listing_id, position: i });
                setWall(true);
              }}
              onRetry={() => run()}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3.5">
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
