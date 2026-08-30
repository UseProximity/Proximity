"use client";

/*
 * "Create your account", for a student who has just posted a review while
 * signed out.
 *
 * This is the signup half of the QR flow, and it comes BEFORE the profile
 * fields on purpose: signing in with Google can change which email the account
 * ends up under, and discovering that after they have filled in a profile means
 * asking them to do it twice.
 *
 * Two ways out, the same two the normal signup card offers:
 *   - Continue with Google. Leaves the page for the OAuth round trip and comes
 *     back to /review/claim, which reconciles the address Google returns
 *     against the one they typed into the review.
 *   - Set a password. Stays on the page. The account still cannot be signed
 *     into until the emailed link verifies the address (see
 *     /api/profile/set-review-password), which the confirmation copy says.
 *
 * The email is shown but locked: it is what the review was filed under, and
 * changing it here would silently detach them from it.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { INPUT_CLASS } from "./reviewFormUi";
import { trackEvent } from "@/utils/analytics";

const MIN_PASSWORD_LENGTH = 8;

export default function ReviewAccountStep({
  token,
  email,
  onPasswordSet,
  onSkip,
  heading = "Create your account",
  intro = "Your review is posted. Set up sign-in so you can come back to it, edit it, save places and message landlords.",
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  function handleGoogle() {
    setGoogleLoading(true);
    trackEvent("review_account_started", { provider: "google" });
    /*
     * The token rides in the callback URL rather than localStorage because this
     * step also renders from the emailed link, on a device that never had the
     * review flow open and so has nothing stored.
     */
    signIn("google", {
      callbackUrl: `/review/claim?token=${encodeURIComponent(token)}`,
    });
  }

  async function handlePassword(e) {
    e.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/profile/set-review-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't save your password.");
        return;
      }
      trackEvent("review_account_started", { provider: "password" });
      onPasswordSet?.(data);
    } catch {
      toast.error("Couldn't save your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
          <span aria-hidden="true">✓</span> Review posted
        </div>
        <h2 className="text-xl font-bold text-gray-900">{heading}</h2>
        <p className="mt-1 text-sm text-gray-600">{intro}</p>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading || saving}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-gray-300 bg-white font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
          <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.8-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-3.7-13.6-9.0l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {googleLoading ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">or</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handlePassword} className="space-y-3">
        <div>
          <label htmlFor="account-email" className="block text-sm text-gray-600 mb-1.5">
            Email
          </label>
          <input
            id="account-email"
            type="email"
            value={email || ""}
            readOnly
            className={`${INPUT_CLASS} bg-gray-100 text-gray-500`}
          />
          <p className="mt-1 text-xs text-gray-500">The address your review was posted under.</p>
        </div>

        <div>
          <label htmlFor="account-password" className="block text-sm text-gray-600 mb-1.5">
            Create a password <span className="text-red-500">*</span>
          </label>
          <input
            id="account-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            className={INPUT_CLASS}
          />
          {tooShort && (
            <p className="mt-1 text-sm text-red-600">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="account-confirm" className="block text-sm text-gray-600 mb-1.5">
            Confirm password <span className="text-red-500">*</span>
          </label>
          <input
            id="account-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT_CLASS}
          />
          {mismatch && <p className="mt-1 text-sm text-red-600">Passwords don&apos;t match.</p>}
        </div>

        <button
          type="submit"
          disabled={!canSubmit || saving || googleLoading}
          className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>

      <button
        type="button"
        onClick={onSkip}
        className="mt-2 w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition"
      >
        Not now, I&apos;ll finish it later
      </button>
    </div>
  );
}
