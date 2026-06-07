"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Instagram } from "lucide-react";
const Logo = "/logo.svg";

const CONTACT_EMAIL = "info@useproximity.org";

const NAV_COLS = [
  {
    heading: "Product",
    links: [
      { label: "Browse Listings", href: "/browse" },
      { label: "On Campus Hub", href: "/CampusHub" },
      { label: "Matchmaking", href: "/matchmaking" },
      { label: "Add Sublease", href: "/dashboard/student?addSublease=1" },
    ],
  },
  {
    heading: "Company",
    links: [{ label: "About Us", href: "/about" }],
    contactButton: true,
    social: true,
  },
];

const SocialIcons = () => (
  <div className="flex items-center gap-4">
    <Link
      href="https://www.instagram.com/useproximity"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram"
      className="text-gray-500 hover:text-white transition-colors duration-200"
    >
      <Instagram className="h-5 w-5" />
    </Link>
    <Link
      href="https://www.tiktok.com/@useproximity"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="TikTok"
      className="text-gray-500 hover:text-white transition-colors duration-200"
    >
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
      </svg>
    </Link>
  </div>
);

export default function Footer() {
  const [copied, setCopied] = useState(false);

  function handleCopyEmail() {
    navigator.clipboard.writeText(CONTACT_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  // Opens the site-wide FeedbackWidget modal (mounted in the root layout).
  function handleOpenFeedback() {
    window.dispatchEvent(new Event("proximity:open-feedback"));
  }

  return (
    <footer className="bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-8 pb-6 md:pt-10 md:pb-8">
        {/* ── Mobile: centered ── */}
        <div className="flex flex-col items-center text-center mb-12 md:hidden">
          <Link href="/" className="flex items-center gap-2 mb-4">
            <Image
              src={Logo}
              alt="Proximity"
              width={38}
              height={38}
              className="object-contain"
            />
            <span className="text-xl font-bold text-white">Proximity</span>
          </Link>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm mb-6">
            Better apartments. Honest reviews. Zero stress. The first platform
            built entirely for students to find and secure off-campus housing
            with confidence.
          </p>
          <div className="flex justify-evenly w-full">
            {NAV_COLS.map((col) => (
              <div
                key={col.heading}
                className="flex flex-col items-center h-full"
              >
                <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                  {col.heading}
                </h4>
                <ul className="space-y-3 text-center">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {col.contactButton && (
                    <li>
                      <button
                        onClick={handleCopyEmail}
                        className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
                      >
                        {copied ? "Copied!" : "Contact Us"}
                      </button>
                      {copied && (
                        <p className="text-xs text-green-400 mt-1">
                          {CONTACT_EMAIL} copied
                        </p>
                      )}
                    </li>
                  )}
                </ul>
                {col.social && (
                  <div className="mt-4 flex justify-center">
                    <SocialIcons />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Desktop: original grid ── */}
        <div className="hidden md:grid grid-cols-4 gap-10 md:gap-8">
          {/* Brand block */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-5">
              <Image
                src={Logo}
                alt="Proximity"
                width={38}
                height={38}
                className="object-contain"
              />
              <span className="text-xl font-bold text-white">Proximity</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xs mb-6">
              Better apartments. Honest reviews. Zero stress. The first platform
              built entirely for students to find and secure off-campus housing
              with confidence.
            </p>
          </div>

          {/* Nav columns */}
          {NAV_COLS.map((col) => (
            <div key={col.heading} className="flex flex-col h-full">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-5">
                {col.heading}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
                {col.contactButton && (
                  <li>
                    <button
                      onClick={handleCopyEmail}
                      className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
                    >
                      {copied ? "Copied!" : "Contact Us"}
                    </button>
                    {copied && (
                      <p className="text-xs text-green-400 mt-1">
                        {CONTACT_EMAIL} copied
                      </p>
                    )}
                  </li>
                )}
              </ul>
              {col.social && (
                <div className="mt-4">
                  <SocialIcons />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-4 pt-4 border-t border-gray-800/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            © 2026 Proximity. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={handleOpenFeedback}
              className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
            >
              Report a bug / suggest a fix
            </button>
            <p className="text-sm text-gray-600">
              Made for students, by students.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
