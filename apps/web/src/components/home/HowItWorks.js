"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { ArrowRight, FileText, CheckCircle2, AlertTriangle, CalendarDays } from "lucide-react";

/*
 * The homepage's 1-2-3 of the whole journey (Wyatt, 2026-11-23): get matched
 * from the Find Your Place survey (shown at its open text page), talk to Proxy
 * to tour and apply, then run the lease through Lease Check before signing.
 *
 * Each card carries a small picture of that step and no description: the
 * picture is the explanation (Wyatt, 2026-11-23). The pictures are drawings,
 * not live controls: hidden from screen readers and not clickable. The link
 * under each one is the way in.
 */

// Each picture sits in a grey well, a shade darker than the section behind
// the card, so it reads as a look at the product rather than as part of the
// card's own controls.
function Stage({ children }) {
  return (
    <div className="mt-6 flex flex-1 flex-col rounded-2xl bg-gray-100/70 p-4" aria-hidden="true">
      {children}
    </div>
  );
}
const FAKE_CHIP = "rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-600";

function SurveyMock() {
  return (
    <Stage>
      <p className="text-[13px] font-medium text-gray-900">What are you looking for?</p>
      <div className="mt-2.5 min-h-[104px] rounded-2xl border border-red-300 bg-white px-4 py-3 text-sm leading-relaxed text-gray-800">
        A quiet place near the Loop with in-unit laundry and parking. We have a cat.
        <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-red-600" />
      </div>
      <p className="mt-4 text-xs font-medium text-gray-500">Amenities</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={FAKE_CHIP}>Dishwasher</span>
        <span className={FAKE_CHIP}>Gym</span>
        <span className={FAKE_CHIP}>Balcony</span>
        <span className={FAKE_CHIP}>Study spaces</span>
      </div>
      <div className="mt-auto flex justify-end pt-5">
        <span className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white">Show My Matches</span>
      </div>
    </Stage>
  );
}

function ProxyMock() {
  const proxy = "max-w-[85%] self-start rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] leading-snug text-gray-800 shadow-sm";
  const me = "max-w-[85%] self-end rounded-2xl rounded-br-md bg-red-600 px-3.5 py-2.5 text-[13px] leading-snug text-white";
  return (
    <Stage>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">P</span>
        <div>
          <p className="text-[11px] leading-none text-gray-500">Messaging</p>
          <p className="mt-1 text-sm font-bold leading-none text-gray-900">Proxy</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <p className={proxy}>Hey, I&apos;m Proxy. Ask me anything about this listing.</p>
        <p className={me}>Are cats allowed? And can we see it this week?</p>
        <p className={proxy}>Cats are welcome. Tap Tour to pick times that work for you.</p>
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-5">
        <span className="min-w-0 flex-1 truncate rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs text-gray-400">
          Ask a follow-up
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-red-600 px-3 py-2 text-xs font-semibold text-white">
          <CalendarDays className="h-3.5 w-3.5" /> Tour
        </span>
        <span className="flex-shrink-0 rounded-full border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-600">
          Apply
        </span>
      </div>
    </Stage>
  );
}

function LeaseMock() {
  return (
    <Stage>
      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3.5 py-3">
        <FileText className="h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-gray-900">My Lease.pdf</p>
          <p className="text-[11px] text-gray-500">12 pages checked</p>
        </div>
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
      </div>
      <p className="mt-4 text-xs font-medium text-gray-500">Read these closely</p>
      <div className="mt-2 flex flex-col gap-2">
        <div className="rounded-2xl border border-gray-200 bg-white px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> Leaving early
          </p>
          <p className="mt-1 text-xs leading-snug text-gray-600">Ending the lease early costs two months of rent.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> Repairs
          </p>
          <p className="mt-1 text-xs leading-snug text-gray-600">You pay for appliance repairs yourself.</p>
        </div>
      </div>
    </Stage>
  );
}

const STEPS = [
  {
    title: "Get Matched",
    Mock: SurveyMock,
    href: "/find-your-place",
    link: "Find Your Place",
  },
  {
    title: "Tour and Apply with Proxy",
    Mock: ProxyMock,
    href: "/browse",
    link: "Browse Listings",
  },
  {
    title: "Check Your Lease",
    Mock: LeaseMock,
    href: "/lease-check",
    link: "Check a Lease",
  },
];

export default function HowItWorks({ sideMargin }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="w-full border-y border-gray-200 bg-gray-50 py-16 md:py-22">
      <div className={`mx-auto w-full max-w-[1440px] ${sideMargin}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-8 md:mb-10"
        >
          <div>
            <span className="mb-3 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-widest text-red-500">
              How it works
            </span>
            <h2 className="text-4xl font-black text-gray-900 md:text-5xl">Three steps to your place.</h2>
          </div>
        </motion.div>

        <ol className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {STEPS.map(({ title, Mock, href, link }, i) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.1 }}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)] sm:p-6"
            >
              <div className="flex items-center gap-3.5">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-gray-200 text-lg font-semibold text-gray-600">
                  {i + 1}
                </span>
                <h3 className="min-w-0 text-xl font-bold leading-tight text-gray-900">{title}</h3>
              </div>
              <Mock />
              <Link
                href={href}
                className="mt-5 flex items-center gap-1.5 self-start text-sm font-semibold text-red-500 transition-colors hover:text-red-600"
              >
                {link} <ArrowRight className="h-4 w-4" />
              </Link>
            </motion.li>
          ))}
        </ol>

      </div>
    </section>
  );
}
