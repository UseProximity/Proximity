/*
 * /support: the public support page, used as the Support URL in App Store Connect.
 *
 * Deliberately tiny: a headline, one sentence, the contact email and a quiet pointer to
 * the policies. Public and static (no sign-in, no form, no ticket system). Sits in the
 * (legal) group for the shared Footer.
 */
import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";

const SUPPORT_EMAIL = "info@useproximity.org";
const closingLinkClass =
  "underline decoration-gray-300 underline-offset-4 transition-colors hover:text-red-500 hover:decoration-red-300 focus:outline-none focus-visible:text-red-500";

export const metadata = {
  title: "Proximity Support",
  description:
    "Get help with your Proximity account or the Proximity app. Contact the Proximity team by email.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <main className="relative isolate flex min-h-[calc(100dvh-83px)] items-center md:min-h-[calc(100dvh-104px)] justify-center overflow-hidden bg-gradient-to-b from-red-50 via-white to-white px-5 py-20 sm:py-28">
      {/* Soft red glows behind the content. Decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-red-200/50 blur-3xl sm:h-96 sm:w-96"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 right-0 -z-10 h-64 w-64 rounded-full bg-rose-100/70 blur-3xl sm:h-80 sm:w-80"
      />

      <div className="w-full max-w-xl text-center">
        <p className="inline-flex items-center rounded-full border border-red-100 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-red-500 shadow-sm">
          Support
        </p>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-gray-950 sm:text-6xl">
          We&apos;re here to <span className="text-red-500">help.</span>
        </h1>

        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-gray-500 sm:text-lg">
          If you need help with Proximity, send us an email and we&apos;ll get back to you.
        </p>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="group mx-auto mt-10 flex w-full max-w-sm items-center gap-4 rounded-2xl border border-red-100 bg-white p-4 text-left shadow-lg shadow-red-100/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-red-200 hover:shadow-xl hover:shadow-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium uppercase tracking-wide text-gray-400">
              Email us
            </span>
            <span className="block break-all text-base font-semibold text-gray-950 sm:text-lg">
              {SUPPORT_EMAIL}
            </span>
          </span>
          <ArrowUpRight
            className="h-5 w-5 shrink-0 text-gray-300 transition-colors duration-200 group-hover:text-red-500"
            aria-hidden="true"
          />
        </a>

        {/* Closing detail: a quiet pointer to the policies, not a section. */}
        <div className="mx-auto mt-16 max-w-xs border-t border-red-100 pt-6 sm:mt-20">
          <p className="text-sm text-gray-400">Looking for something else?</p>
          <p className="mt-2 flex items-center justify-center gap-3 text-sm text-gray-500">
            <Link href="/privacy" className={closingLinkClass}>
              Privacy Policy
            </Link>
            <span aria-hidden="true" className="text-gray-300">
              &middot;
            </span>
            <Link href="/terms" className={closingLinkClass}>
              Terms of Service
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
