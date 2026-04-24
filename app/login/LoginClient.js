"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";

export default function LoginClient({ callbackUrl }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to continue</h1>
        <p className="text-gray-500 text-sm mb-8">
          You need to be logged in to access this page.
        </p>

        <button
          onClick={() => signIn("google", { callbackUrl })}
          className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition"
        >
          Continue with Google
        </button>

        <Link
          href="/"
          className="inline-block mt-6 text-sm text-gray-400 hover:text-gray-600 transition"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
