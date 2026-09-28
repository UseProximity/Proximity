"use client";

/*
 * The return leg of "Continue with Google" in the QR review flow.
 *
 * Three things can be true when we land here, and the student has to be told
 * which:
 *
 *   1. Google returned the same address they typed into the review. auth.js
 *      matches an existing row by email, so they are already signed into the
 *      very account holding the review. Straight on to the profile.
 *
 *   2. Google returned a DIFFERENT address. There are now two accounts and the
 *      review is on the one they cannot sign into. This is the case worth
 *      interrupting for: keep the review on the account they just signed into,
 *      or go back and use a different Google account.
 *
 *   3. The token is spent or expired (they already finished, or waited a week).
 *      Nothing is broken, so say so and send them on.
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import toast from "react-hot-toast";
import ProfileCompletionStep from "@/components/reviews/ProfileCompletionStep";
import { PAGE_BOTTOM_PADDING } from "@/components/reviews/reviewFormUi";

const SETUP_TOKEN_KEY = "prx_review_setup_token";

function clearStoredToken() {
  try {
    localStorage.removeItem(SETUP_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

export default function ClaimReviewClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const { status } = useSession();

  const [state, setState] = useState("loading"); // loading | mismatch | profile | expired | done
  const [info, setInfo] = useState(null); // { reviewEmail, sessionEmail, reviewCount }
  const [prefill, setPrefill] = useState(null);
  const [moving, setMoving] = useState(false);

  const loadPrefill = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/profile/complete-from-review?token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data?.prefill ?? null;
    } catch {
      return null;
    }
  }, [token]);

  useEffect(() => {
    if (status === "loading") return;
    if (!token) {
      setState("expired");
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/profile/claim-review?token=${encodeURIComponent(token)}`
        );
        if (!active) return;
        if (!res.ok) {
          setState("expired");
          return;
        }
        const data = await res.json();
        if (!active) return;
        if (data.sameAccount) {
          setPrefill(await loadPrefill());
          if (active) setState("profile");
        } else {
          setInfo(data);
          setState("mismatch");
        }
      } catch {
        if (active) setState("expired");
      }
    })();
    return () => {
      active = false;
    };
  }, [token, status, loadPrefill]);

  async function keepOnSignedInAccount() {
    if (moving) return;
    setMoving(true);
    try {
      const res = await fetch("/api/profile/claim-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't move your review.");
        return;
      }
      // The placeholder account is gone, so its token is gone with it.
      clearStoredToken();
      setState("done");
    } catch {
      toast.error("Couldn't move your review. Please try again.");
    } finally {
      setMoving(false);
    }
  }

  function useDifferentGoogleAccount() {
    // Sign out first, otherwise Google silently returns the same account.
    signOut({ callbackUrl: `/review/claim?token=${encodeURIComponent(token)}&retry=1` });
  }

  const shell = (children) => (
    <div className={`max-w-xl mx-auto px-4 py-10 ${PAGE_BOTTOM_PADDING}`}>{children}</div>
  );

  if (state === "loading") {
    return shell(<p className="py-16 text-center text-gray-500">Checking your account…</p>);
  }

  if (state === "expired") {
    return shell(
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set</h1>
        <p className="text-gray-600">
          This account setup link has already been used or has expired. Your review is
          safe.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (state === "done") {
    return shell(
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h1>
        <p className="text-gray-600">
          Your review now lives on your{" "}
          <span className="font-semibold">{info?.sessionEmail}</span> account, and
          you&apos;re signed in.
        </p>
        <Link
          href="/listings"
          className="mt-6 inline-block px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
        >
          Browse listings
        </Link>
      </div>
    );
  }

  if (state === "mismatch") {
    return shell(
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
        <h1 className="text-xl font-bold text-gray-900">
          These are two different emails
        </h1>
        <p className="mt-2 text-sm text-gray-700">
          You left your review under{" "}
          <span className="font-semibold">{info?.reviewEmail}</span>, but you just signed
          in with <span className="font-semibold">{info?.sessionEmail}</span>. Which
          account should keep it?
        </p>

        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            onClick={keepOnSignedInAccount}
            disabled={moving}
            className="w-full text-left px-4 py-4 rounded-xl border border-gray-200 bg-white hover:border-red-300 transition disabled:opacity-50"
          >
            <span className="block text-[15px] font-semibold text-gray-900">
              {moving ? "Moving…" : `Keep it on ${info?.sessionEmail}`}
            </span>
            <span className="mt-0.5 block text-sm text-gray-500">
              The account you&apos;re signed into now. We&apos;ll move your review
              {info?.reviewCount > 1 ? "s" : ""} over and you&apos;re done.
            </span>
          </button>

          <button
            type="button"
            onClick={useDifferentGoogleAccount}
            disabled={moving}
            className="w-full text-left px-4 py-4 rounded-xl border border-gray-200 bg-white hover:border-red-300 transition disabled:opacity-50"
          >
            <span className="block text-[15px] font-semibold text-gray-900">
              Sign in with a different Google account
            </span>
            <span className="mt-0.5 block text-sm text-gray-500">
              Use {info?.reviewEmail} instead, or pick another address.
            </span>
          </button>
        </div>
      </div>
    );
  }

  return shell(
    <ProfileCompletionStep
      token={token}
      prefill={prefill}
      onCompleted={() => {
        clearStoredToken();
        setState("done");
      }}
      onSkip={() => setState("done")}
      heading="One last thing: finish your profile"
      intro="You're signed in. Fill in the rest and your Proximity account is ready to use."
    />
  );
}
