import Image from "next/image";
import Link from "next/link";
import Logo from "@/public/logo.png";
import { Home, Plus, Search, User, Menu, Users } from "lucide-react";
import ButtonAuth from "./ButtonAuth";

export function Header({ currentPath, session }) {
  return (
    <header className="sticky top-0 z-50 px-4 py-1 border-b border-white/20 bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <div className="flex items-center justify-between w-full mx-auto h-[64px]">
        <div className="flex items-center gap-4">
          {/* Logo with fixed height */}
          <Link href="/" className="flex items-center gap-0">
            <div className="h-14 w-auto">
              <Image
                src={Logo}
                alt="Proximity Logo"
                className="h-full w-auto object-contain"
                priority
              />
            </div>
            <span className="text-xl font-bold text-gray-900 self-center">
              Proximity
            </span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
            <Link
              href="/browse"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition ${
                currentPath === "/browse"
                  ? "text-red-600 bg-red-50"
                  : "text-gray-700 hover:text-red-600 hover:bg-red-50"
              }`}
            >
              <Search className="h-4 w-4" />
              Browse
            </Link>
            <Link
              href="/CampusHub"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition ${
                currentPath === "/CampusHub"
                  ? "text-red-600 bg-red-50"
                  : "text-gray-700 hover:text-red-600 hover:bg-red-50"
              }`}
            >
              <Home className="h-4 w-4" />
              On Campus Hub
            </Link>
            {session?.user?.role === "landlord" && (
              <Link
                href="/add-listing"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition ${
                  currentPath === "/add-listing"
                    ? "text-red-600 bg-red-50"
                    : "text-gray-700 hover:text-red-600 hover:bg-red-50"
                }`}
              >
                <Plus className="h-4 w-4" />
                Add Listing
              </Link>
            )}
            {session?.user?.role === "student" && (
              <Link
                href="/add-sub-lease"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition ${
                  currentPath === "/add-sub-lease"
                    ? "text-red-600 bg-red-50"
                    : "text-gray-700 hover:text-red-600 hover:bg-red-50"
                }`}
              >
                <Plus className="h-4 w-4" />
                Sub-Lease
              </Link>
            )}
            {session?.user?.role === "student" && (
              <Link
                href="/roommate-finder"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-full shadow transition ${
                  currentPath === "/roommate-finder"
                    ? "text-white bg-gradient-to-r from-[#b80000] to-[#d62828]"
                    : "text-white bg-gradient-to-r from-[#cc0100] to-[#e63946] hover:from-[#b80000] hover:to-[#d62828]"
                }`}
              >
                <Users className="h-4 w-4" />
                Roommates
              </Link>
            )}
          </nav>
        </div>

        <ButtonAuth session={session} />
      </div>
    </header>
  );
}
