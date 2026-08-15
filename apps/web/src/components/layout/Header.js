/*
 * Site-wide navigation header rendered on every page by the root layout. Receives the
 * server-side session and adapts its UI to auth state and role: discovery links sit
 * on the left, listing/lease actions on the right. Most destinations are icons with
 * hover labels or hover menus. Authenticated users get a profile icon to their
 * dashboard; sign-out lives on the dashboard itself. Contains an expandable address
 * search bar (using AddressSearchInput) that routes to /browse?search= on submit, and
 * a slide-in mobile menu that auto-closes on route change.
 */
"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
const Logo = "/logo.svg";
import {
  Search,
  X,
  Menu,
  Building2,
  Users,
  Compass,
  Plus,
  User,
} from "lucide-react";
import AddressSearchInput from "@/components/listings/AddressSearchInput";
import { usePathname, useRouter } from "next/navigation";
import { recordPageVisit } from "@/utils/analytics";

function iconBtnClass(active) {
  return `relative flex items-center justify-center h-9 w-9 rounded-lg transition-colors ${
    active
      ? "text-red-500 bg-red-50"
      : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
  }`;
}

function MenuLink({ href, label, active, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "text-red-500 bg-red-50/80"
          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      {label}
    </Link>
  );
}

function HoverMenu({ label, active, icon: Icon, align = "left", children }) {
  return (
    <div className="relative group">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="true"
        className={iconBtnClass(active)}
      >
        <Icon className="h-5 w-5" />
      </button>
      <div
        className={`absolute top-full pt-1.5 z-50 hidden group-hover:block group-focus-within:block ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        <div className="min-w-[200px] rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl">
          <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {label}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Header({ session }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const inputRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // The header renders on every page, so it doubles as the route tracker that
  // lets analytics answer "which page did the user come from?".
  useEffect(() => {
    recordPageVisit(pathname);
  }, [pathname]);

  // Build a /browse URL from the given params, preserving the current map/list
  // view when the user searches while already on the browse page — otherwise a
  // search from map view would bounce them back to the list view on mobile.
  const buildBrowseUrl = (params) => {
    const search = new URLSearchParams(params);
    if (pathname === "/browse" && typeof window !== "undefined") {
      const view = new URLSearchParams(window.location.search).get("view");
      if (view) search.set("view", view);
    }
    return `/browse?${search.toString()}`;
  };

  const submitSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(buildBrowseUrl({ search: query.trim() }));
    setSearchOpen(false);
    setQuery("");
  };

  const handleSuggestionSelect = (feature) => {
    const [lng, lat] = feature.center;
    router.push(buildBrowseUrl({ lat, lng }));
    setSearchOpen(false);
    setQuery("");
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const isActive = (path) => {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const role = session?.user?.role;
  const isLandlord = role === "landlord";
  // Super sees both sides: market discovery plus the landlord create flow.
  const showMatchmaking = !isLandlord;
  const addHref =
    session?.user && role === "student" ? "/add-sublease" : "/add-listing";
  const addLabel = role === "student" ? "Add Sublease" : "Add Listing";
  const dashboardHref =
    role === "landlord" ? "/dashboard/landlord" : "/dashboard/student";

  const exploreLinks = [
    { href: "/guides", label: "Guides" },
    { href: "/CampusHub", label: "On Campus Hub" },
    { href: "/about", label: "Meet the Founder" },
  ];
  // Lease tools sit with create actions — they're for people evaluating / listing a place.
  const listLinks = [
    { href: addHref, label: addLabel },
    ...(!isLandlord
      ? [
          { href: "/review", label: "Add a Review" },
          { href: "/lease-check", label: "Lease Check" },
        ]
      : []),
  ];

  const exploreActive = exploreLinks.some(({ href }) => isActive(href));
  const listActive = listLinks.some(({ href }) => isActive(href));

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-lg border-b border-gray-100">
      <div className="relative w-full flex items-center justify-between h-14 px-4 md:px-6">
        {/* ── Left: Logo + discovery ── */}
        <div
          className={`flex items-center gap-3 md:gap-5 flex-shrink-0 ${
            searchOpen ? "hidden md:flex" : ""
          }`}
        >
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="h-8 w-auto">
              <Image
                src={Logo}
                alt="Proximity"
                width={32}
                height={32}
                className="h-full w-auto object-contain"
                priority
              />
            </div>
            <span className="text-lg font-bold text-gray-900 tracking-tight">
              Proximity
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-0.5" aria-label="Discover">
            <Link
              href="/browse"
              aria-label="Browse listings"
              className={`group ${iconBtnClass(isActive("/browse"))}`}
            >
              <Building2 className="h-5 w-5" />
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                Browse
              </span>
            </Link>

            {showMatchmaking && (
              <Link
                href="/matchmaking"
                aria-label="Matchmaking"
                className={`group ${iconBtnClass(isActive("/matchmaking"))}`}
              >
                <Users className="h-5 w-5" />
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  Matchmaking
                </span>
              </Link>
            )}

            <HoverMenu
              label="Explore"
              active={exploreActive}
              icon={Compass}
            >
              {exploreLinks.map(({ href, label }) => (
                <MenuLink
                  key={href}
                  href={href}
                  label={label}
                  active={isActive(href)}
                />
              ))}
            </HoverMenu>
          </nav>
        </div>

        {/* Mobile search bar — full width, positioned relative to wrapper */}
        {searchOpen && (
          <form
            onSubmit={submitSearch}
            className="md:hidden absolute left-4 right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10 bg-white"
          >
            <AddressSearchInput
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && closeSearch()}
              onSelectSuggestion={handleSuggestionSelect}
              placeholder="Search by title or address..."
              className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 focus:border-red-300 focus:bg-white rounded-lg outline-none transition-all duration-200"
            />
            <button
              type="button"
              onClick={closeSearch}
              className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close search"
            >
              <X className="h-5 w-5" />
            </button>
          </form>
        )}

        {/* ── Right: list/lease + search + auth ── */}
        <div className="flex items-center gap-1">
          <nav className="hidden md:flex items-center gap-0.5" aria-label="List a place">
            {listLinks.length === 1 ? (
              <Link
                href={listLinks[0].href}
                aria-label={listLinks[0].label}
                className={`group ${iconBtnClass(listActive)}`}
              >
                <Plus className="h-5 w-5" />
                <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  {listLinks[0].label}
                </span>
              </Link>
            ) : (
              <HoverMenu
                label="List & lease"
                active={listActive}
                icon={Plus}
                align="right"
              >
                {listLinks.map(({ href, label }) => (
                  <MenuLink
                    key={href}
                    href={href}
                    label={label}
                    active={isActive(href)}
                  />
                ))}
              </HoverMenu>
            )}
          </nav>

          <div className="relative flex-shrink-0">
            {searchOpen ? (
              <>
                <div
                  className="w-9 h-9 opacity-0 pointer-events-none"
                  aria-hidden="true"
                />
                <form
                  onSubmit={submitSearch}
                  className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 items-center gap-2 w-[420px]"
                >
                  <AddressSearchInput
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                    onSelectSuggestion={handleSuggestionSelect}
                    placeholder="Search by title or address..."
                    className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 focus:border-red-300 focus:bg-white rounded-lg outline-none transition-all duration-200"
                  />
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Close search"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </form>
              </>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className={iconBtnClass(false)}
                aria-label="Search"
              >
                <Search className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
            {session?.user ? (
              <Link
                href={dashboardHref}
                aria-label="Dashboard"
                className={`group ${iconBtnClass(pathname.startsWith("/dashboard"))}`}
              >
                <User className="h-5 w-5" />
                <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  Dashboard
                </span>
              </Link>
            ) : (
              <>
                <button
                  onClick={() => router.push("/login")}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
                >
                  Log In
                </button>
                <button
                  onClick={() => router.push("/login?tab=signup")}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>

          {!searchOpen && (
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 z-50 border-t border-gray-100 bg-white/95 backdrop-blur-lg shadow-xl px-4 py-3 flex flex-col gap-0.5">
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Discover
          </p>
          <Link
            href="/browse"
            onClick={() => setMobileMenuOpen(false)}
            className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
              isActive("/browse")
                ? "text-red-500 bg-red-50/80"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            Browse listings
          </Link>
          {showMatchmaking && (
            <Link
              href="/matchmaking"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                isActive("/matchmaking")
                  ? "text-red-500 bg-red-50/80"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              Matchmaking
            </Link>
          )}
          {exploreLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                isActive(href)
                  ? "text-red-500 bg-red-50/80"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </Link>
          ))}

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {isLandlord ? "Your listings" : "List & lease"}
          </p>
          {listLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                isActive(href)
                  ? "text-red-500 bg-red-50/80"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </Link>
          ))}

          <div className="h-px bg-gray-100 my-2" />
          {session?.user ? (
            <Link
              href={dashboardHref}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                pathname.startsWith("/dashboard")
                  ? "text-red-500 bg-red-50/80"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <User className="h-4 w-4" />
              Dashboard
            </Link>
          ) : (
            <div className="flex gap-2 w-full">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  router.push("/login");
                }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-gray-900 bg-white border border-gray-200 hover:bg-gray-50 text-center"
              >
                Log In
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  router.push("/login?tab=signup");
                }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 text-center"
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
