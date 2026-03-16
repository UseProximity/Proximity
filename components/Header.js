"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import Logo from "@/public/logo.png";
import { Search, X } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

export function Header({ session }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const submitSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/browse?search=${encodeURIComponent(query.trim())}`);
    setSearchOpen(false);
    setQuery("");
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const isActive = (path) => pathname === path;

  const navLinks = [
    { href: "/browse", label: "Browse Listings" },
    { href: "/CampusHub", label: "On Campus Hub" },
    { href: "/about", label: "About Us" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-lg border-b border-gray-100">
      {/* Max-width container keeps the two sides from stretching too far apart */}
      <div className="max-w-[1400px] mx-auto flex items-center justify-between h-[104px]">

        {/* ── Left: Logo + Nav ── */}
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-3 flex-shrink-0">
            <div className="h-[56px] w-auto">
              <Image
                src={Logo}
                alt="Proximity"
                className="h-full w-auto object-contain"
                priority
              />
            </div>
            <span className="text-[26px] font-bold text-gray-900 tracking-tight">
              Proximity
            </span>
          </Link>

          {/* Nav links — sits right next to logo */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-4 py-2.5 rounded-lg text-[17px] font-medium transition-all duration-150 whitespace-nowrap ${
                  isActive(href)
                    ? "text-red-500 bg-red-50/80"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {/* ── Right: Search + Auth ── */}
        <div className="flex items-center gap-3">

          {/* Search — icon expands to input */}
          {searchOpen ? (
            <form onSubmit={submitSearch} className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                placeholder="Search addresses..."
                className="w-48 md:w-60 px-4 py-2.5 text-[17px] bg-gray-50 border border-gray-200 focus:border-red-300 focus:bg-white rounded-xl outline-none transition-all duration-200"
              />
              <button
                type="button"
                onClick={closeSearch}
                className="p-2.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                aria-label="Close search"
              >
                <X className="h-6 w-6" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2.5 text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-xl transition-all duration-150"
              aria-label="Search"
            >
              <Search className="h-6 w-6" />
            </button>
          )}

          {/* Auth buttons */}
          <div className="hidden md:flex items-center gap-2.5">
            {session?.user ? (
              <>
                <Link
                  href={
                    session.user.role === "landlord"
                      ? "/dashboard/landlord"
                      : "/dashboard/student"
                  }
                  className="px-5 py-2.5 text-[17px] font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all border border-gray-200"
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="px-5 py-2.5 text-[17px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => signIn("google", { callbackUrl: "/" })}
                  className="px-5 py-2.5 text-[17px] font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-xl border border-gray-200 transition-all duration-150"
                >
                  Log In
                </button>
                <button
                  onClick={() => signIn("google", { callbackUrl: "/" })}
                  className="px-5 py-2.5 text-[17px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all duration-150 shadow-sm shadow-red-400/25"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
            aria-label="Open menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
