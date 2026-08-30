"use client";

/*
 * The review flow's front door, and the owner of everything that isn't the two
 * forms themselves.
 *
 * Rendered by /review (where a scanned QR code lands via /r) and by
 * /refer/<ambassadorId>. Its job is three things the branches shouldn't each
 * solve:
 *
 *   1. Ask the branching question ("have you ever lived off campus?") and hand
 *      off to the property form or the dorm form.
 *   2. Carry the printed code's ?src= tag into both submissions and into
 *      analytics, so a flyer can be judged.
 *   3. Own what happens AFTER a signed-out submission: the review is posted and
 *      an incomplete account now exists, so it offers the profile step rather
 *      than a dead-end thank-you.
 *
 * The profile-setup token is kept in localStorage, which is what makes "I'll
 * finish this later" survive a refresh or a closed tab on the same phone. The
 * same token is emailed as a link for a week, so another device works too. It is
 * NOT a session and cannot sign anyone in.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import ReviewSubmitForm from "./ReviewSubmitForm";
import DormReviewForm from "./DormReviewForm";
import ProfileCompletionStep from "./ProfileCompletionStep";
import ReviewAccountStep from "./ReviewAccountStep";
import { PAGE_BOTTOM_PADDING } from "./reviewFormUi";
import { readReviewSource } from "@/lib/reviews/source";
import { trackEvent } from "@/utils/analytics";

const SETUP_TOKEN_KEY = "prx_review_setup_token";

function readStoredToken() {
  try {
    return localStorage.getItem(SETUP_TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token) {
  try {
    if (token) localStorage.setItem(SETUP_TOKEN_KEY, token);
  } catch {
    /* private mode: the emailed link is the fallback */
  }
}
function clearStoredToken() {
  try {
    localStorage.removeItem(SETUP_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

function BranchCard({ label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-4 rounded-xl border border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/40 transition-colors"
    >
      <span className="block text-[15px] font-semibold text-gray-900">{label}</span>
      <span className="mt-0.5 block text-sm text-gray-500">{hint}</span>
    </button>
  );
}

export default function ReviewFlow({
  referrerId = null,
  referrerName = null,
  callbackUrl = "/review",
}) {
  const searchParams = useSearchParams();
  const source = readReviewSource(searchParams);

  const [branch, setBranch] = useState(null); // "off" | "on"
  /*
   * { token, prefill, email, hasCredentials } once a signed-out review created
   * an account. hasCredentials decides which half of the setup is still owed:
   * the account step (a password or Google) comes before the profile fields,
   * because signing in with Google can change which email the account ends up
   * under, and finding that out after filling in a profile means filling it in
   * twice.
   */
  const [setup, setSetup] = useState(null);
  const [finished, setFinished] = useState(null); // "completed" | "skipped" | "posted" | "existing"
  /*
   * Set when they chose a password rather than Google. The address is still
   * unproven at that point, so the Credentials provider will refuse the login
   * until they open the emailed link, and the closing copy has to say so.
   */
  const [passwordEmail, setPasswordEmail] = useState(null);
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
    if (source) trackEvent("qr_review_start", { src: source });
  }, [source]);

  /*
   * Resume an unfinished profile. Reloading the page, or coming back to it later
   * on the same phone, should pick up where they left off instead of pretending
   * the account was never created. An unknown, expired or already-completed
   * token is simply forgotten.
   */
  useEffect(() => {
    const token = readStoredToken();
    if (!token) {
      setResuming(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/profile/complete-from-review?token=${encodeURIComponent(token)}`
        );
        if (!active) return;
        if (!res.ok) {
          clearStoredToken();
          return;
        }
        const data = await res.json();
        if (active && data?.prefill) {
          setSetup({
            token,
            prefill: data.prefill,
            email: data.email || data.prefill.email || "",
            hasCredentials: !!data.hasCredentials,
          });
        }
      } catch {
        /* leave the token alone; a network blip isn't a dead token */
      } finally {
        if (active) setResuming(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmitted = useCallback(
    (data, which) => {
      trackEvent("review_submitted", {
        src: source || "direct",
        branch: which,
        signedOut: !!data?.setupToken,
      });
      if (data?.setupToken) {
        storeToken(data.setupToken);
        setSetup({
          token: data.setupToken,
          prefill: data.prefill || null,
          email: data.prefill?.email || "",
          // Freshly created by this submission, so it has no way to sign in yet.
          hasCredentials: false,
        });
      } else if (data?.existingAccount) {
        // Signed out, but the email they gave already has an account. There is
        // nothing to set up, so say where the review went instead of thanking
        // them as though they were a stranger.
        setFinished("existing");
      } else {
        setFinished("posted");
      }
    },
    [source]
  );

  function handleProfileCompleted() {
    clearStoredToken();
    setSetup(null);
    setFinished("completed");
  }

  function handleProfileSkipped() {
    setSetup(null);
    setFinished("skipped");
  }

  const shell = (children) => (
    <div className={`max-w-xl mx-auto px-4 py-10 ${PAGE_BOTTOM_PADDING}`}>{children}</div>
  );

  if (finished) {
    const headline =
      finished === "completed"
        ? "You’re all set!"
        : finished === "existing"
        ? "Welcome back!"
        : "Thank you!";

    let body;
    if (finished === "completed") {
      body =
        "Your review is live and your profile is complete. Thanks for helping fellow students find a better place to live.";
    } else if (finished === "existing") {
      body =
        "You already have a Proximity account with that email, so we posted this review to it. Sign in any time to see it.";
    } else if (referrerName) {
      body = `Your review has been posted. Thanks for helping fellow students through ${referrerName}.`;
    } else {
      body =
        "Your review has been posted. Thanks for helping fellow students find a better place to live.";
    }

    return shell(
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{headline}</h1>
        <p className="text-gray-600">{body}</p>
        {finished === "completed" && passwordEmail && (
          <p className="mt-3 text-sm text-gray-500">
            One last step: we sent a link to{" "}
            <span className="font-semibold">{passwordEmail}</span>. Open it to confirm
            your email, then you can sign in with your new password.
          </p>
        )}
        {finished === "skipped" && (
          <p className="mt-3 text-sm text-gray-500">
            We emailed you a link to finish setting up your account whenever you&apos;re
            ready.
          </p>
        )}
        {finished === "existing" && (
          <Link
            href="/login"
            className="mt-6 inline-block px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
          >
            Sign in
          </Link>
        )}
      </div>
    );
  }

  if (setup && !setup.hasCredentials) {
    return shell(
      <ReviewAccountStep
        token={setup.token}
        email={setup.email}
        onPasswordSet={(data) => {
          setPasswordEmail(data?.emailVerified ? null : data?.email || setup.email);
          setSetup((prev) => ({ ...prev, hasCredentials: true }));
        }}
        onSkip={handleProfileSkipped}
      />
    );
  }

  if (setup) {
    return shell(
      <ProfileCompletionStep
        token={setup.token}
        prefill={setup.prefill}
        onCompleted={handleProfileCompleted}
        onSkip={handleProfileSkipped}
      />
    );
  }

  return shell(
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leave a review</h1>
        <p className="text-gray-600 mt-1">
          {referrerName && (
            <>
              Referred by <span className="font-semibold">{referrerName}</span>.{" "}
            </>
          )}
          Tell other students what it was really like to live there. No account needed,
          it takes about two minutes.
        </p>
      </header>

      {!branch ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <div className="flex items-center gap-2 mb-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-semibold text-red-600">
              ?
            </span>
            <h2 className="text-sm font-semibold text-gray-800">
              Have you ever lived off campus?
            </h2>
          </div>
          <div className="space-y-2.5">
            <BranchCard
              label="Yes, I've rented off campus"
              hint="Review the property, its landlord and your unit."
              onClick={() => setBranch("off")}
            />
            <BranchCard
              label="No, I've only lived on campus"
              hint="Review the dorm you live in or lived in."
              onClick={() => setBranch("on")}
            />
          </div>
          {resuming && (
            <p className="mt-4 text-xs text-gray-400">Checking for a saved review…</p>
          )}
        </motion.div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setBranch(null)}
            aria-label="Back"
            className="mb-4 -ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition"
          >
            <span aria-hidden="true" className="text-base leading-none">&#8592;</span>
            Back
          </button>

          {branch === "off" ? (
            <ReviewSubmitForm
              referrerId={referrerId}
              referrerName={referrerName}
              callbackUrl={callbackUrl}
              source={source}
              onSubmitted={(data) => handleSubmitted(data, "off_campus")}
            />
          ) : (
            <DormReviewForm
              source={source}
              onSubmitted={(data) => handleSubmitted(data, "on_campus")}
            />
          )}
        </>
      )}
    </>
  );
}
