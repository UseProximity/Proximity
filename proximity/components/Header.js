"use client";

import Image from "next/image";
import Link from "next/link";
import { useUser } from "@/context/UserContext";
import Logo from "@/public/logo.png";
import { useRouter } from "next/navigation";

export function Header() {
  const { role, loginAs, logout } = useUser();
  const router = useRouter();

  const handleLogout = () => {
    router.push("/");
    logout();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur px-4 py-5">
      <div className="flex items-center justify-between w-full">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center space-x-16 pl-2">
          <Link href="/" className="flex items-center space-x-1">
            <div className="relative -my-2">
              <Image
                src={Logo}
                alt="Proximity Logo"
                width={56}
                height={56}
                className="object-contain"
              />
            </div>

            <span className="text-2xl font-bold text-gray-900 leading-none">
              Proximity
            </span>
          </Link>

          <nav className="flex items-center space-x-8 text-base font-medium">
            <Link href="/browse" className="text-gray-700 hover:text-gray-900">
              Browse Listings
            </Link>
            <Link
              href="/CampusHub"
              className="text-gray-700 hover:text-gray-900"
            >
              On Campus Hub
            </Link>
            {role === "landlord" && (
              <Link
                href="/add-listing"
                className="text-gray-700 hover:text-gray-900"
              >
                Add a Listing
              </Link>
            )}
            {role === "student" && (
              <Link
                href="/add-sub-lease"
                className="text-gray-700 hover:text-gray-900"
              >
                Add a Sub-Lease
              </Link>
            )}
            {role === "student" && (
              <Link
                href="/roommate-finder"
                className="px-3 py-2 text-sm font-semibold text-white bg-gradient-to-r from-[#cc0100] to-[#e63946] rounded-full shadow hover:from-[#b80000] hover:to-[#d62828] transition
"
              >
                Roommate Finder
              </Link>
            )}
          </nav>
        </div>

        {/* Right: Login or User Info + Dashboard */}
        <div className="flex items-center space-x-4 pr-2">
          {role ? (
            <>
              <Link
                href={
                  role === "student"
                    ? "/dashboard/student"
                    : "/dashboard/landlord"
                }
              >
                <button className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                  Go to Dashboard
                </button>
              </Link>
              <span className="text-sm text-gray-600">
                Logged in as: <strong>{role}</strong>
              </span>
              <button
                onClick={handleLogout}
                className="px-3 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => loginAs("student")}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Student Login
              </button>
              <button
                onClick={() => loginAs("landlord")}
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-600 hover:bg-red-50 rounded-lg"
              >
                Landlord Login
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
