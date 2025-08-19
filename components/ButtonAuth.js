"use client";

import { Home, Plus, Search, User, Menu, Users } from "lucide-react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useState } from "react";

export default function ButtonLogIn({ role }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSignOut = () => {
    setIsLoading(true);
    signOut({ callbackUrl: "/" });
    setIsLoading(false);
  };
  return (
    <>
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
              className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded-md"
              onClick={handleSignOut}
            >
              {isLoading && (
                <span className="animate-spin">Logging out...</span>
              )}
              Log out
            </button>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-2">
            <button
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              onClick={() => signIn(undefined, { callbackUrl: "/" })}
            >
              Login
            </button>
          </div>
        )}
      </div>
    </>
  );
}
