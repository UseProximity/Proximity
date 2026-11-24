"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/*
 * Homepage FAQ. The questions are from the homepage design; the answers are
 * DRAFTS awaiting Wyatt's review (2026-11-23), kept to what the product does
 * today. Change them here.
 */
const FAQS = [
  {
    q: "Is Proximity free for students?",
    a: "Yes. Browsing listings, getting matched, messaging landlords and checking your lease are all free for students.",
  },
  {
    q: "Is Proximity affiliated with WashU?",
    a: "No. Proximity is an independent platform built by WashU students for WashU students. It is not run or endorsed by the university.",
  },
  {
    q: "Are the reviews from real WashU students?",
    a: "Reviews are written by students with a Proximity account about places they have lived, and our team reads each one before it is published. Landlords can reply to a review, but they cannot edit it.",
  },
  {
    q: "How do I know a listing is real?",
    a: "Listings come from the landlords and property managers we work with, and from students posting their own subleases. If anything looks off, report the listing from its page and we will look into it.",
  },
  {
    q: "Can I find roommates on Proximity?",
    a: "Not yet. Today Proximity matches you, or your whole group, to a place: tell us how many of you there are and we look for places that fit everyone.",
  },
  {
    q: "Can Proximity check my lease before I sign?",
    a: "Yes. Upload it to Lease Check and it points out the parts worth reading closely, in plain English. It explains what your lease says. It is not legal advice.",
  },
];

export default function HomeFaq({ sideMargin }) {
  const [open, setOpen] = useState(null);

  return (
    <section className="w-full bg-white py-16 md:py-22">
      <div className={`mx-auto grid w-full max-w-[1440px] gap-8 ${sideMargin} lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16`}>
        <h2 className="text-4xl font-black text-gray-900 md:text-5xl">FAQ</h2>
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={item.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`home-faq-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-semibold text-gray-900 transition-colors hover:text-red-600 focus:outline-none focus-visible:text-red-600 md:text-xl"
                  >
                    {item.q}
                    <ChevronDown
                      className={`h-5 w-5 flex-shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </h3>
                {/* Always in the HTML (search engines read the answers); the
                    grid row animates between closed and open. */}
                <div
                  id={`home-faq-${i}`}
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className={`overflow-hidden ${isOpen ? "" : "invisible"}`}>
                    <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-gray-600">{item.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
