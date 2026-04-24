"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginClient({ callbackUrl, initialTab }) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(initialTab === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationSentTo, setVerificationSentTo] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    if (searchParams.get("verified") === "1") {
      setVerificationSentTo("");
    }
    if (searchParams.get("error") === "invalid_token") {
      setError("Verification link is invalid or expired. Please request a new one below.");
    }
  }, [searchParams]);

  const switchTab = (t) => {
    setTab(t);
    setError("");
    setVerificationSentTo("");
    setResendMsg("");
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setVerificationSentTo("");
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (!result) {
      setError("Something went wrong. Please try again.");
      return;
    }
    if (result.error === "EMAIL_NOT_VERIFIED") {
      setVerificationSentTo(email);
      return;
    }
    if (result.error) {
      setError("Invalid email or password.");
      return;
    }
    window.location.href = result.url ?? callbackUrl;
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError("");
    setVerificationSentTo("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign up failed. Please try again.");
      } else {
        setVerificationSentTo(data.email);
        setName("");
        setEmail("");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    setResendMsg("");
    setResendLoading(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verificationSentTo }),
      });
      setResendMsg("Resent! Check your inbox.");
    } catch {
      setResendMsg("Failed to resend. Please try again.");
    }
    setResendLoading(false);
  };

  const verified = searchParams.get("verified") === "1";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          {tab === "signin" ? "Sign in to continue" : "Create your account"}
        </h1>

        {/* Tab toggle */}
        <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
          <button
            onClick={() => switchTab("signin")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "signin"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => switchTab("signup")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "signup"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Sign Up
          </button>
        </div>

        {verified && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm">
            Email verified! You can now sign in.
          </div>
        )}

        {verificationSentTo ? (
          <div className="text-center">
            <div className="mb-4 px-4 py-4 rounded-lg bg-blue-50 text-blue-800 text-sm leading-relaxed">
              <p className="font-semibold mb-1">Check your inbox</p>
              <p>
                We sent a verification link to{" "}
                <span className="font-medium">{verificationSentTo}</span>.
              </p>
            </div>
            <p className="text-sm text-gray-500 mb-3">Didn't get it?</p>
            <button
              onClick={handleResend}
              disabled={resendLoading}
              className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-60 transition"
            >
              {resendLoading ? "Sending…" : "Resend verification email"}
            </button>
            {resendMsg && (
              <p className="mt-2 text-sm text-gray-500">{resendMsg}</p>
            )}
            <button
              onClick={() => { setVerificationSentTo(""); setResendMsg(""); }}
              className="block mx-auto mt-4 text-sm text-gray-400 hover:text-gray-600 transition"
            >
              ← Back
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-600 text-sm">
                {error}
              </div>
            )}

            {tab === "signin" ? (
              <form onSubmit={handleSignIn} className="flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 rounded-lg transition"
                >
                  {loading ? "Signing in…" : "Continue with Email"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
                />
                <input
                  type="password"
                  placeholder="Password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 rounded-lg transition"
                >
                  {loading ? "Creating account…" : "Create Account"}
                </button>
              </form>
            )}

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button
              onClick={() => signIn("google", { callbackUrl })}
              className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg transition"
            >
              Continue with Google
            </button>
          </>
        )}

        <Link
          href="/"
          className="block mt-6 text-center text-sm text-gray-400 hover:text-gray-600 transition"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
