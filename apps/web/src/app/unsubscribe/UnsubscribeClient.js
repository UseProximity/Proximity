"use client";

/*
 * Where the footer "Unsubscribe" link of a mass email lands. It unsubscribes as
 * soon as the page loads (the click is the person's choice; the POST runs from
 * the browser so a link scanner fetching the URL does nothing), then offers a
 * way back in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OPT_OUT_INBOX } from "@/lib/emailFooter";

function Card({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-md text-center">{children}</div>
    </div>
  );
}

export default function UnsubscribeClient({ token }) {
  // working | unsubscribed | resubscribed | invalid | error
  const [state, setState] = useState(token ? "working" : "invalid");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const call = useCallback(
    async (action) => {
      const res = await fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}&action=${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) return setState("invalid");
      if (!res.ok) return setState("error");
      setEmail(data.email ?? "");
      setState(action === "resubscribe" ? "resubscribed" : "unsubscribed");
    },
    [token]
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    call("unsubscribe").catch(() => setState("error"));
  }, [token, call]);

  const flip = async (action) => {
    setBusy(true);
    await call(action).catch(() => setState("error"));
    setBusy(false);
  };

  if (state === "working") {
    return (
      <Card>
        <p className="text-sm text-gray-500">Unsubscribing...</p>
      </Card>
    );
  }

  if (state === "invalid" || state === "error") {
    return (
      <Card>
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          {state === "invalid" ? "This link is not valid" : "Something went wrong"}
        </h1>
        <p className="text-sm text-gray-600 mb-4">
          Email{" "}
          <a href={`mailto:${OPT_OUT_INBOX}?subject=unsubscribe`} className="text-red-500 hover:text-red-600 font-medium">
            {OPT_OUT_INBOX}
          </a>{" "}
          with &quot;unsubscribe&quot; and we will take you off the list.
        </p>
        {state === "error" && (
          <button
            onClick={() => flip("unsubscribe")}
            disabled={busy}
            className="text-sm text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
          >
            Try again
          </button>
        )}
      </Card>
    );
  }

  const out = state === "unsubscribed";
  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900 mb-3">{out ? "You are unsubscribed" : "You are subscribed again"}</h1>
      <p className="text-sm text-gray-600 mb-2">
        {out
          ? `${email || "This address"} will no longer get announcements from Proximity.`
          : `${email || "This address"} will get Proximity announcements again.`}
      </p>
      {out && (
        <p className="text-sm text-gray-500 mb-6">
          You will still get emails about your own account, like messages, password resets and invoices.
        </p>
      )}
      <div className="flex flex-col items-center gap-3 mt-4">
        <button
          onClick={() => flip(out ? "resubscribe" : "unsubscribe")}
          disabled={busy}
          className="px-5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
        >
          {busy ? "Saving..." : out ? "Unsubscribed by mistake? Resubscribe" : "Unsubscribe again"}
        </button>
        <Link href="/" className="text-sm text-red-500 hover:text-red-600 font-medium transition">
          Go to Proximity
        </Link>
      </div>
    </Card>
  );
}
