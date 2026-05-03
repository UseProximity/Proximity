"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      {/* Background canvas */}
      <div className="absolute inset-0">
        {/* Soft pink gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #fff1f2 0%, #ffe4e6 50%, #ffe7ea 100%)",
          }}
        />

        {/* Subtle dot pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-multiply"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.5) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />

        {/* Gentle darkening for white text legibility */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.12))]" />

        {/* Blend with white header (64px tall) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white to-transparent" />

        {/* Cloud shapes */}
        <svg
          className="pointer-events-none absolute left-6 top-24 h-28 w-48 text-white/70"
          viewBox="0 0 200 80"
          fill="currentColor"
        >
          <path d="M40 60h120a20 20 0 100-40 28 28 0 00-51-9A30 30 0 0056 32a20 20 0 100 28z" />
        </svg>
        <svg
          className="pointer-events-none absolute right-10 top-36 h-20 w-36 text-white/60"
          viewBox="0 0 200 80"
          fill="currentColor"
        >
          <path d="M40 60h120a20 20 0 100-40 28 28 0 00-51-9A30 30 0 0056 32a20 20 0 100 28z" />
        </svg>
        <svg
          className="pointer-events-none absolute left-1/3 bottom-20 h-16 w-28 text-white/55"
          viewBox="0 0 200 80"
          fill="currentColor"
        >
          <path d="M40 60h120a20 20 0 100-40 28 28 0 00-51-9A30 30 0 0056 32a20 20 0 100 28z" />
        </svg>

        {/* Floating minimal shapes (kept, recolored to match) */}
        <div className="pointer-events-none absolute inset-0">
          <svg
            className="absolute left-10 top-16 h-10 w-10 text-rose-400/70 animate-bounce"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="12" cy="12" r="6" />
          </svg>
          <svg
            className="absolute right-16 top-24 h-6 w-6 text-rose-300/60 animate-[spin_20s_linear_infinite]"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-3.9 5.5-.8z" />
          </svg>
          <svg
            className="absolute left-1/2 top-1/3 h-8 w-8 -translate-x-1/2 text-rose-300/70 animate-pulse"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="4" y="4" width="16" height="16" rx="4" />
          </svg>
        </div>

        {/* Content (unchanged) */}
        <section className="relative z-10 mx-auto grid max-w-5xl place-items-center px-6 py-24 text-white">
          <div className="text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-medium text-rose-700 backdrop-blur">
              Error
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              404
            </p>

            <h1 className="mt-6 bg-gradient-to-r from-rose-600 via-red-600 to-rose-500 bg-clip-text text-7xl font-extrabold leading-none tracking-tight text-transparent drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)] sm:text-8xl md:text-9xl">
              404
            </h1>

            <h2 className="mt-4 text-2xl font-semibold text-rose-700 drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)] sm:text-3xl">
              This page wandered off campus
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-rose-700/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">
              The page you’re trying to reach doesn’t exist or has been moved.
              Let’s get you back to housing near your university.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/browse"
                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                Browse listings
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-5 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                Go home
              </Link>
              <button
                onClick={() => history.back()}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-transparent px-5 py-3 font-semibold text-white/80 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                Go back
              </button>
            </div>
          </div>
        </section>

        {/* Stairs motif (unchanged) */}
        <div className="pointer-events-none absolute bottom-6 right-6 hidden text-fuchsia-200/40 sm:block">
          <div className="flex flex-col items-end space-y-1">
            <div className="h-2 w-24 rounded bg-white/10" />
            <div className="h-2 w-28 rounded bg-white/10" />
            <div className="h-2 w-32 rounded bg-white/10" />
            <div className="h-2 w-36 rounded bg-white/10" />
          </div>
        </div>
      </div>
    </main>
  );
}
