"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordClient({ token }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm text-center">
          <p className="text-red-600 text-sm mb-4">Invalid or missing reset link.</p>
          <Link href="/login" className="text-sm text-red-500 hover:text-red-600 font-medium transition">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        router.push("/login?reset=1");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Set new password</h1>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 rounded-lg transition"
          >
            {loading ? "Saving…" : "Reset Password"}
          </button>
        </form>

        <Link
          href="/login"
          className="block mt-6 text-center text-sm text-gray-400 hover:text-gray-600 transition"
        >
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
