"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loginFallbackUrl(threadId) {
  const callback = threadId
    ? `/messages?thread=${encodeURIComponent(threadId)}`
    : "/messages";
  return `/login?callbackUrl=${encodeURIComponent(callback)}`;
}

function threadUrl(threadId) {
  return threadId ? `/messages?thread=${encodeURIComponent(threadId)}` : "/messages";
}

export default function ChatLinkClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();

  const rawToken = searchParams.get("token") ?? "";
  const threadParam = searchParams.get("t") ?? "";

  const [peek, setPeek] = useState(null);
  const [peekStatus, setPeekStatus] = useState("loading"); // loading | ready | invalid
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const threadId = useMemo(() => {
    if (peek?.threadId && UUID_RE.test(peek.threadId)) return peek.threadId;
    if (UUID_RE.test(threadParam)) return threadParam;
    return null;
  }, [peek, threadParam]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!rawToken.trim()) {
        if (!cancelled) setPeekStatus("invalid");
        return;
      }
      try {
        const res = await fetch(
          `/api/chat/access-token?token=${encodeURIComponent(rawToken.trim())}`
        );
        if (!res.ok) {
          if (!cancelled) setPeekStatus("invalid");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setPeek(data);
        setPeekStatus("ready");
      } catch {
        if (!cancelled) setPeekStatus("invalid");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [rawToken]);

  const redeem = useCallback(async () => {
    setActionError("");
    setBusy(true);
    try {
      const result = await signIn("chat-link", {
        token: rawToken.trim(),
        redirect: false,
        callbackUrl: threadUrl(threadId),
      });
      if (!result || result.error) {
        setActionError("This link is invalid or has already been used.");
        setBusy(false);
        return;
      }
      window.location.href = result.url ?? threadUrl(threadId);
    } catch {
      setActionError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }, [rawToken, threadId]);

  const continueAsLinkUser = useCallback(async () => {
    setActionError("");
    setBusy(true);
    try {
      await signOut({ redirect: false });
      const result = await signIn("chat-link", {
        token: rawToken.trim(),
        redirect: false,
        callbackUrl: threadUrl(threadId),
      });
      if (!result || result.error) {
        setActionError("This link is invalid or has already been used.");
        setBusy(false);
        return;
      }
      window.location.href = result.url ?? threadUrl(threadId);
    } catch {
      setActionError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }, [rawToken, threadId]);

  const staySignedIn = useCallback(() => {
    router.push(threadUrl(null));
  }, [router]);

  const shell = (children) => (
    <div className="min-h-[calc(100dvh-83px)] md:min-h-[calc(100dvh-104px)] flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm">{children}</div>
    </div>
  );

  if (peekStatus === "loading" || (peekStatus === "ready" && sessionStatus === "loading")) {
    return shell(<p className="text-sm text-gray-400 text-center">Loading…</p>);
  }

  if (peekStatus === "invalid") {
    // Already signed in: the link is spent but they don't need it — send them to the inbox
    // rather than a sign-in wall. No thread deep link, since an expired token can't prove
    // which conversation this was or that they belong to it.
    const signedIn = !!session?.user?.id;
    return shell(
      <>
        <h1 className="text-xl font-bold text-gray-900 mb-3 text-center">Link already used</h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          {signedIn
            ? "This conversation link has already been used or expired. Your messages are still here."
            : "This conversation link is invalid, expired, or has already been used. Sign in to open your messages."}
        </p>
        <a
          href={signedIn ? "/messages" : loginFallbackUrl(threadId)}
          className="block w-full text-center py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition"
        >
          {signedIn ? "Go to your messages" : "Sign in to continue"}
        </a>
      </>
    );
  }

  // Different user signed in — chooser
  if (session?.user?.id && peek?.userId && session.user.id !== peek.userId) {
    const currentLabel = session.user.email || session.user.name || "another account";
    const linkLabel = peek.email || peek.name || "the link account";
    return shell(
      <>
        <h1 className="text-xl font-bold text-gray-900 mb-3 text-center">Switch accounts?</h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          You&apos;re signed in as <span className="font-medium text-gray-900">{currentLabel}</span>.
          This link is for <span className="font-medium text-gray-900">{linkLabel}</span>.
        </p>
        {actionError ? (
          <p className="text-sm text-red-600 mb-4 text-center">{actionError}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={continueAsLinkUser}
          className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition disabled:opacity-60 mb-3"
        >
          {busy ? "Switching…" : `Continue as ${peek.name?.split(" ")[0] || linkLabel}`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={staySignedIn}
          className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition disabled:opacity-60"
        >
          Stay signed in
        </button>
      </>
    );
  }

  // Logged out, or already signed in as the link's own user. Both redeem on click: the
  // token is single-use, so opening the thread without spending it would leave a working
  // key in an inbox the recipient has already acted on.
  return shell(
    <>
      <h1 className="text-xl font-bold text-gray-900 mb-3 text-center">Open conversation</h1>
      <p className="text-sm text-gray-600 mb-6 text-center">
        {peek?.name
          ? `Continue to your Proximity messages as ${peek.name.split(" ")[0]}.`
          : "Continue to your Proximity messages."}
      </p>
      {actionError ? (
        <p className="text-sm text-red-600 mb-4 text-center">{actionError}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={redeem}
        className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition disabled:opacity-60"
      >
        {busy ? "Opening…" : "Open conversation"}
      </button>
      <p className="text-xs text-gray-400 mt-4 text-center">
        Having trouble?{" "}
        <a href={loginFallbackUrl(threadId)} className="text-red-500 hover:underline">
          Sign in normally
        </a>
      </p>
    </>
  );
}
