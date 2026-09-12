"use client";

/*
 * The signed-out hand-off to a property's own waitlist form.
 *
 * Why it exists: once the browser reaches docs.google.com we can see nothing,
 * so this is the last chance to learn who we sent. Asking for the details here
 * also means we can inject them into the landlord's form, so the student types
 * them once rather than twice.
 *
 * The copy says what we do with the answers. An account appears either way, and
 * a "finish your account" prompt plus an email half an hour later reads as spam
 * if the first time anyone hears about it is after the fact.
 *
 * Signed-in students never see this: the listing links them straight at the API
 * route, which already knows them.
 */

import { useState } from "react";
import Modal from "@/components/ui/Modal";

const EMPTY = { firstName: "", lastName: "", email: "", phone: "" };

export default function WaitlistDialog({ isOpen, onClose, listingId, propertyName }) {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Set once the hand-off succeeds; holds the setup token and the destination,
  // so a blocked popup still leaves the student something to click.
  const [done, setDone] = useState(null);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const close = () => {
    setForm(EMPTY);
    setError(null);
    setDone(null);
    setLoading(false);
    onClose?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    /*
     * Opened BEFORE the request, inside the click that triggered it. A tab
     * opened after an await has lost the user gesture that authorizes it and
     * browsers block it silently, which would strand the student on our modal
     * having already given us their details.
     */
    const tab = window.open("", "_blank", "noopener");
    setLoading(true);

    try {
      const res = await fetch(`/api/waitlist/${listingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.url) {
        tab?.close();
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }

      if (tab) tab.location = data.url;
      setDone({ url: data.url, setupToken: data.setupToken, blocked: !tab });
    } catch {
      tab?.close();
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const field =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

  return (
    <Modal isOpen={isOpen} onClose={close}>
      <div className="p-6">
        {done ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                You&apos;re on your way to the waitlist
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {done.blocked
                  ? "Your browser blocked the new tab. Open the waitlist form to finish signing up."
                  : `${propertyName}'s form opened in a new tab, already filled in with your details.`}
              </p>
            </div>

            {done.blocked && (
              <a
                href={done.url}
                target="_blank"
                rel="noopener nofollow"
                className="block w-full rounded-lg bg-red-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Open the waitlist form
              </a>
            )}

            {done.setupToken && (
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">
                  Finish setting up your account
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Add a password to save this and track your other applications on
                  Proximity. It takes a minute.
                </p>
                <a
                  href={`/review/finish?token=${encodeURIComponent(done.setupToken)}`}
                  className="mt-3 inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"
                >
                  Finish my account
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={close}
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Join the {propertyName} waitlist
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                We&apos;ll fill these into {propertyName}&apos;s form for you and save
                them to a Proximity account so you can track your applications.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="waitlist-first" className="mb-1 block text-xs font-medium text-gray-700">
                  First name
                </label>
                <input
                  id="waitlist-first"
                  className={field}
                  value={form.firstName}
                  onChange={set("firstName")}
                  autoComplete="given-name"
                  required
                />
              </div>
              <div>
                <label htmlFor="waitlist-last" className="mb-1 block text-xs font-medium text-gray-700">
                  Last name
                </label>
                <input
                  id="waitlist-last"
                  className={field}
                  value={form.lastName}
                  onChange={set("lastName")}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="waitlist-email" className="mb-1 block text-xs font-medium text-gray-700">
                Email
              </label>
              <input
                id="waitlist-email"
                type="email"
                className={field}
                value={form.email}
                onChange={set("email")}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="waitlist-phone" className="mb-1 block text-xs font-medium text-gray-700">
                Phone number
              </label>
              <input
                id="waitlist-phone"
                type="tel"
                className={field}
                value={form.phone}
                onChange={set("phone")}
                autoComplete="tel"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {loading ? "Opening the waitlist..." : "Continue to the waitlist"}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
