import Link from "next/link";
import Image from "next/image";
import { Instagram } from "lucide-react";
import Logo from "@/public/logo.png";

const NAV_COLS = [
  {
    heading: "Product",
    links: [
      { label: "Browse Listings", href: "/browse" },
      { label: "On Campus Hub", href: "/CampusHub" },
      { label: "Add a Sublease", href: "/add-sub-lease" },
      { label: "Roommate Finder", href: "/roommate-finder" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "For Landlords", href: "/add-listing" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-14 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-8">

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
              Better apartments. Honest reviews. Zero stress. The first platform built entirely for students to find and secure off-campus housing with confidence.
            </p>
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
          </div>

          {/* Nav columns */}
          {NAV_COLS.map((col) => (
            <div key={col.heading}>
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
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-14 pt-6 border-t border-gray-800/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-600">
            © 2025 Proximity. All rights reserved.
          </p>
          <p className="text-xs text-gray-600">
            Made for students, by students.
          </p>
        </div>
      </div>
    </footer>
  );
}
