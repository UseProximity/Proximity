"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Mail } from "lucide-react";

const POINTS = [
  "What WashU requires for first and second years",
  "What off-campus really costs vs. the dorms",
  "The four kinds of housing near campus",
  "What to check before your student signs",
];

export default function ParentSignupClient() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState("idle"); // idle | busy | done
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setState("busy");
    try {
      const res = await fetch("/api/parent-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setState("idle");
    }
  }

  return (
    <main className="relative min-h-[calc(100dvh-83px)] md:min-h-[calc(100dvh-104px)] overflow-hidden bg-gradient-to-br from-rose-50 via-white to-gray-50 px-4 py-10 sm:py-16">
      <div className="pointer-events-none absolute -top-24 right-[-6rem] h-96 w-96 rounded-full bg-rose-200/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-5rem] left-[-4rem] h-80 w-80 rounded-full bg-orange-100/60 blur-3xl" />

      <div className="relative mx-auto w-full max-w-md">
        <div className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-gray-100 sm:p-8">
          {state === "done" ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <Mail size={22} />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-gray-950">Check your inbox</h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                We sent the guide to <span className="font-medium text-gray-900">{email}</span>. It
                can take a minute to arrive, and it may land in Promotions or Spam.
              </p>
              <Link
                href="/guides/washu-parent-guide"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-red-500 py-3 font-semibold text-white transition hover:bg-red-600"
              >
                Read it now
              </Link>
            </div>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
                <BookOpen size={13} /> Free guide
              </span>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-gray-950 sm:text-3xl">
                The WashU housing guide for parents
              </h1>
              <ul className="mt-5 space-y-2.5">
                {POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <Check size={16} className="mt-0.5 shrink-0 text-rose-500" />
                    {point}
                  </li>
                ))}
              </ul>

              <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
                <div>
                  <label htmlFor="parent-first-name" className="mb-1 block text-sm font-medium text-gray-700">
                    First name <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="parent-first-name"
                    type="text"
                    autoComplete="given-name"
                    maxLength={60}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                </div>
                <div>
                  <label htmlFor="parent-email" className="mb-1 block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id="parent-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                </div>

                {/* Honeypot: hidden from people, filled by bots. */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="hidden"
                />

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={state === "busy" || !email.trim()}
                  className="w-full rounded-xl bg-red-500 py-3 font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
                >
                  {state === "busy" ? "Sending…" : "Email me the guide"}
                </button>
              </form>

              <p className="mt-4 text-center text-xs leading-5 text-gray-500">
                We may send occasional housing tips. Unsubscribe any time. See our{" "}
                <Link href="/privacy" className="underline hover:text-gray-700">
                  privacy policy
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
