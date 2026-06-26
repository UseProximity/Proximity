import Link from "next/link";

export default function GuideCTA() {
  return (
    <section className="mt-12 overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50">
      <div className="p-6 sm:p-8 lg:p-10">
        <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600 shadow-sm">
          Ready to start?
        </span>

        <h2 className="mt-4 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
          Find the right WashU apartment faster.
        </h2>

        <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600 sm:text-lg sm:leading-8">
          Skip hours of scrolling through listings. Get matched with apartments
          based on your budget, preferences and lifestyle - fueled by real WashU
          student experiences.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/matchmaking"
            className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-6 py-3 font-semibold text-white transition hover:bg-rose-700"
          >
            Get my free housing match
          </Link>

          <Link
            href="/browse"
            className="inline-flex items-center justify-center rounded-2xl border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-900 transition hover:border-gray-400"
          >
            Browse listings
          </Link>
        </div>
      </div>
    </section>
  );
}
