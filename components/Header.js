"use client";

import Image from "next/image";
import Link from "next/link";
import { useUser } from "@/context/UserContext";
import Logo from "@/public/logo.png";
import { usePathname, useRouter } from "next/navigation";
import { Home, Plus, Search, User, Menu, Users } from "lucide-react";

export function Header() {
  const { role, loginAs, logout } = useUser();
  const router = useRouter();
  const currentPath = usePathname();
  const handleLogout = () => {
    router.push("/");
    logout();
  };
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-1 sticky top-0 z-50 backdrop-blur-sm">
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
            {role === "landlord" && (
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
            {role === "student" && (
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
            {role === "student" && (
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

        {/* Right: Auth Buttons */}
        <div className="flex items-center gap-2">
          {/* Mobile toggle */}
          <button className="md:hidden text-gray-600 hover:text-gray-900">
            <Menu className="h-5 w-5" />
          </button>

          {role ? (
            <div className="hidden md:flex items-center gap-2">
              <Link
                href={
                  role === "student"
                    ? "/dashboard/student"
                    : "/dashboard/landlord"
                }
              >
                <button className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition">
                  Dashboard
                </button>
              </Link>
              <div className="flex items-center gap-1.5">
                <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-gray-600" />
                </div>
                <div className="flex flex-col leading-none">
                  <span className="text-sm font-medium capitalize">{role}</span>
                  <span className="text-xs text-gray-500">Logged in</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded-md"
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => loginAs("student")}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Student Login
              </button>
              <button
                onClick={() => loginAs("landlord")}
                className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-600 hover:bg-red-50 rounded-md"
              >
                Landlord Login
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
