"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import Logo from "@/public/logo.png";
import { Search, X, Menu } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

export function Header({ session }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const inputRef = useRef(null);
  const signUpRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handler = (e) => {
      if (signUpRef.current && !signUpRef.current.contains(e.target)) {
        setSignUpOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

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
      <div className="w-full flex items-center justify-between h-[83px] md:h-[104px] px-8 md:px-12">

        {/* ── Left: Logo + Nav ── */}
        <div className={`flex items-center gap-10 flex-shrink-0 ${searchOpen ? "hidden md:flex" : ""}`}>
          <Link href="/" className="flex items-center gap-3 flex-shrink-0">
            <div className="h-[56px] w-auto">
              <Image src={Logo} alt="Proximity" className="h-full w-auto object-contain" priority />
            </div>
            <span className="text-[26px] font-bold text-gray-900 tracking-tight">Proximity</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-4 py-2.5 rounded-lg text-[17px] font-medium transition-all duration-150 whitespace-nowrap ${
                  isActive(href) ? "text-red-500 bg-red-50/80" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {/* ── Right: Search + Auth + Hamburger ── */}
        <div className="flex items-center gap-2">

          {/* Search */}
          {searchOpen ? (
            <form onSubmit={submitSearch} className="flex items-center gap-2 w-[280px] md:w-[480px] max-w-[480px]">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                placeholder="Search addresses..."
                className="flex-1 min-w-0 px-4 py-2.5 text-[17px] bg-gray-50 border border-gray-200 focus:border-red-300 focus:bg-white rounded-xl outline-none transition-all duration-200"
              />
              <button
                type="button"
                onClick={closeSearch}
                className="flex-shrink-0 p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
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

          {/* Auth buttons — desktop only */}
          <div className="hidden md:flex items-center gap-2.5">
              {session?.user ? (
                <>
                  <Link
                    href={session.user.role === "landlord" ? "/dashboard/landlord" : "/dashboard/student"}
                    className={`flex items-center gap-2 px-5 py-2.5 text-[17px] font-medium rounded-xl transition-all border ${
                      pathname.startsWith("/dashboard")
                        ? "text-red-500 bg-red-50/80 border-red-200 hover:bg-red-100/70"
                        : "text-gray-700 hover:text-gray-900 hover:bg-gray-50 border-gray-200"
                    }`}
                  >
                    <Image
                      src={pathname.startsWith("/dashboard") ? "/assets/profile-icon-1.svg" : "/assets/profile-icon.svg"}
                      alt="Profile"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
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
                  <div ref={signUpRef} className="relative">
                    <button
                      onClick={() => setSignUpOpen((v) => !v)}
                      className="flex items-center gap-1.5 px-5 py-2.5 text-[17px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all duration-150 shadow-sm shadow-red-400/25"
                    >
                      Sign Up
                      <svg className={`h-4 w-4 transition-transform duration-150 ${signUpOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {signUpOpen && (
                      <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-gray-100 shadow-xl overflow-hidden z-50">
                        <button
                          onClick={() => { setSignUpOpen(false); signIn("google", { callbackUrl: "/?role=student" }); }}
                          className="w-full px-4 py-3 text-left text-[15px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Student
                        </button>
                        <div className="h-px bg-gray-100" />
                        <button
                          onClick={() => { setSignUpOpen(false); signIn("google", { callbackUrl: "/?role=landlord" }); }}
                          className="w-full px-4 py-3 text-left text-[15px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Landlord
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

          {/* Mobile hamburger */}
          {!searchOpen && (
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden flex-shrink-0 p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu — absolute overlay so it doesn't push content down */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 z-50 border-t border-gray-100 bg-white/95 backdrop-blur-lg shadow-xl px-4 py-4 flex flex-col gap-1">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileMenuOpen(false)}
              className={`px-4 py-3 rounded-xl text-[17px] font-medium transition-all ${
                isActive(href) ? "text-red-500 bg-red-50/80" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="h-px bg-gray-100 my-2" />
          {session?.user ? (
            <>
              <Link
                href={session.user.role === "landlord" ? "/dashboard/landlord" : "/dashboard/student"}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[17px] font-medium transition-all ${
                  pathname.startsWith("/dashboard")
                    ? "text-red-500 bg-red-50/80"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Image
                  src={pathname.startsWith("/dashboard") ? "/assets/profile-icon-1.svg" : "/assets/profile-icon.svg"}
                  alt="Profile"
                  width={20}
                  height={20}
                  className="w-5 h-5"
                />
                Dashboard
              </Link>
              <button
                onClick={() => { setMobileMenuOpen(false); signOut({ callbackUrl: "/" }); }}
                className="px-4 py-3 rounded-xl text-[17px] font-medium text-gray-600 hover:bg-gray-50 transition-all text-left"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              {/* Log In + Sign Up side by side */}
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => { setMobileMenuOpen(false); signIn("google", { callbackUrl: "/" }); }}
                  className="flex-1 mr-4 py-3 rounded-xl text-[16px] font-medium text-gray-900 bg-white border border-gray-200 hover:bg-gray-50 transition-all text-center"
                >
                  Log In
                </button>
                <div className="relative flex-1 flex" ref={signUpRef}>
                  <button
                    onClick={() => setSignUpOpen((v) => !v)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-[16px] font-medium text-white bg-red-500 hover:bg-red-600 transition-all"
                  >
                    Sign Up
                    <svg className={`h-4 w-4 transition-transform duration-150 ${signUpOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {signUpOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-100 shadow-xl overflow-hidden z-50">
                      <button
                        onClick={() => { setSignUpOpen(false); setMobileMenuOpen(false); signIn("google", { callbackUrl: "/?role=student" }); }}
                        className="w-full px-4 py-3 text-left text-[15px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Student
                      </button>
                      <div className="h-px bg-gray-100" />
                      <button
                        onClick={() => { setSignUpOpen(false); setMobileMenuOpen(false); signIn("google", { callbackUrl: "/?role=landlord" }); }}
                        className="w-full px-4 py-3 text-left text-[15px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Landlord
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}
