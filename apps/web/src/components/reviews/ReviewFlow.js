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
import { useSession } from "next-auth/react";
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
  /*
   * Present when this flow was opened from an emailed invite:
   * { token, email, prefill }. It changes two things and nothing else. The
   * reviewer's email is supplied rather than asked for, and the account that
   * results is already email-verified, because the token proved the inbox
   * before the review was written rather than after.
   */
  invite = null,
}) {
  const searchParams = useSearchParams();
  const source = readReviewSource(searchParams);
  const { data: session } = useSession();
  const sessionEmail = session?.user?.email || null;
  /*
   * An invite link opened on a device already signed in as a different account.
   * The API takes the session over the invite (a real login outranks a mailed
   * token) and leaves the invite unspent, so the UI must not promise otherwise.
   */
  const signedInElsewhere =
    !!invite && !!sessionEmail && sessionEmail.toLowerCase() !== invite.email.toLowerCase();

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
  /*
   * What the last submission told us, held while we ask whether they want to
   * review somewhere else. Applying it is deferred to leaveLoop() so that
   * saying "yes" can return to the branch question without the profile step or
   * a thank-you flashing past in between.
   */
  const [pending, setPending] = useState(null);
  const [askAnother, setAskAnother] = useState(false);
  /*
   * Property reviews are capped per account (dorm reviews are not), so the
   * offer to write another is withheld once the account is at the cap rather
   * than letting them fill in a form the API would reject.
   */
  const [atCap, setAtCap] = useState(false);
  /*
   * Who the reviewer said they were on their first submission, carried into
   * any further ones. Without this a second review asks a signed-out student
   * for their name, class and email all over again — and a different address
   * typed the second time would fork them onto a second account, which breaks
   * the batching outright by splitting one session across two reviewers.
   */
  const [reviewerContact, setReviewerContact] = useState(
    invite?.prefill
      ? {
          firstName: invite.prefill.firstName || "",
          lastName: invite.prefill.lastName || "",
          classYear: invite.prefill.classYear || "",
          email: invite.email,
        }
      : null
  );

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

  /*
   * Ask the server to send the batched confirmation now.
   *
   * Only ever an early send: /api/cron/review-confirmations covers the same
   * reviews 30 minutes on, so a failure here costs a little delay and nothing
   * else. That is why it is fire-and-forget and never blocks the screen.
   */
  const flushConfirmation = useCallback((token) => {
    fetch("/api/reviews/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupToken: token || null }),
    }).catch(() => {
      /* the sweep is the backstop */
    });
  }, []);

  /*
   * Leave the review loop and settle up. A signed-out reviewer is handed the
   * profile step first — the confirmation waits until we know whether they
   * finished it, so the email can either carry the setup link or not. Everyone
   * else has nothing left to do, so their confirmation goes out now.
   */
  const leaveLoop = useCallback(
    (outcome) => {
      setAskAnother(false);
      if (outcome?.setupToken) {
        setSetup({
          token: outcome.setupToken,
          prefill: outcome.prefill || null,
          email: outcome.prefill?.email || "",
          hasCredentials: false,
        });
        return;
      }
      flushConfirmation(null);
      setFinished(outcome?.existingAccount ? "existing" : "posted");
    },
    [flushConfirmation]
  );

  const handleSubmitted = useCallback(
    (data, which) => {
      trackEvent("review_submitted", {
        src: source || "direct",
        branch: which,
        signedOut: !!data?.setupToken,
      });
      // Freshly created by this submission, so it has no way to sign in yet.
      if (data?.setupToken) storeToken(data.setupToken);

      const outcome = {
        setupToken: data?.setupToken || null,
        prefill: data?.prefill || null,
        // Signed out, but the email they gave already has an account. There is
        // nothing to set up, so say where the review went instead of thanking
        // them as though they were a stranger.
        existingAccount: !!data?.existingAccount,
      };

      /*
       * Only the property form reports a count; dorm reviews are uncapped, so a
       * missing count means there is no ceiling to be at.
       */
      const capped =
        typeof data?.reviewCount === "number" &&
        typeof data?.reviewLimit === "number" &&
        data.reviewCount >= data.reviewLimit;
      if (data?.prefill) {
        setReviewerContact({
          firstName: data.prefill.firstName || "",
          lastName: data.prefill.lastName || "",
          email: data.prefill.email || "",
          classYear: data.prefill.graduationYear
            ? String(data.prefill.graduationYear)
            : "",
        });
      }

      setAtCap(capped);
      setPending(outcome);

      // At the cap there is nothing to offer, so settle up straight away.
      if (capped) leaveLoop(outcome);
      else setAskAnother(true);
    },
    [source, leaveLoop]
  );

  function handleProfileCompleted() {
    // The token is spent, so the confirmation must go out without a setup link.
    flushConfirmation(null);
    clearStoredToken();
    setSetup(null);
    setFinished("completed");
  }

  /*
   * No flush here, on purpose. They still have an account to finish, so the
   * 30-minute sweep is left to send the confirmation — by then the setup token
   * is either spent (they came back) or still live, and the email says the
   * right thing either way. Flushing now would mail them a "finish your
   * account" link seconds after they declined to.
   */
  function handleProfileSkipped() {
    setSetup(null);
    setFinished("skipped");
  }

  const shell = (children) => (
    <div className={`max-w-xl mx-auto px-4 py-10 ${PAGE_BOTTOM_PADDING}`}>{children}</div>
  );

  if (askAnother) {
    return shell(
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Thanks!</h1>
        <p className="text-gray-600">
          Your review has been posted. Lived somewhere else? Reviewing it too takes
          another minute and helps the next student just as much.
        </p>
        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => {
              trackEvent("review_another_accepted", { src: source || "direct" });
              // Back to the branching question: the next place may be a dorm
              // even when the last one wasn't.
              setAskAnother(false);
              setPending(null);
              setBranch(null);
            }}
            className="w-full px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
          >
            Review another place
          </button>
          <button
            type="button"
            onClick={() => {
              trackEvent("review_another_declined", { src: source || "direct" });
              leaveLoop(pending);
            }}
            className="w-full px-5 py-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold transition"
          >
            No thanks
          </button>
        </div>
      </div>
    );
  }

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
            We&apos;ll email you a link to finish setting up your account whenever
            you&apos;re ready.
          </p>
        )}
        {atCap && (
          <p className="mt-3 text-sm text-gray-500">
            That&apos;s the most reviews we take from one account — thanks for all of
            them.
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
        {invite && !signedInElsewhere && (
          <p className="mt-2 text-sm text-gray-500">
            You&apos;re posting as{" "}
            <span className="font-semibold text-gray-700">{invite.email}</span>, the
            address we sent your invite to.
          </p>
        )}
        {/*
          Signed in as somebody else on this device. The review will post under
          the account that is actually logged in, and the invite stays unused, so
          say so rather than showing an address their review will not carry.
        */}
        {signedInElsewhere && (
          <p className="mt-2 text-sm text-amber-700">
            You&apos;re signed in as{" "}
            <span className="font-semibold">{sessionEmail}</span>, so your review
            posts under that account rather than {invite.email}. Log out first if
            you meant to use the invite.
          </p>
        )}
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
              initialContact={reviewerContact}
              inviteToken={invite?.token || null}
              lockedEmail={invite?.email || null}
            />
          ) : (
            <DormReviewForm
              source={source}
              onSubmitted={(data) => handleSubmitted(data, "on_campus")}
              initialContact={reviewerContact}
              inviteToken={invite?.token || null}
              lockedEmail={invite?.email || null}
            />
          )}
        </>
      )}
    </>
  );
}
