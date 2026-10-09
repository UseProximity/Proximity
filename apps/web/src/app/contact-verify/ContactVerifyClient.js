"use client";

import { useState } from "react";

export default function ContactVerifyClient({
  token,
  email,
  landlordName,
  alreadyConfirmed,
  valid,
}) {
  const [state, setState] = useState(alreadyConfirmed ? "done" : "idle"); // idle | busy | done | error

  async function confirm() {
    setState("busy");
    try {
      const res = await fetch("/api/contact-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  const shell = (children) => (
    <div className="min-h-[calc(100dvh-83px)] md:min-h-[calc(100dvh-104px)] flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm text-center">{children}</div>
    </div>
  );

  if (!valid) {
    return shell(
      <>
        <h1 className="text-xl font-bold text-gray-900 mb-3">Link expired</h1>
        <p className="text-sm text-gray-600">
          This confirmation link is invalid or has expired. Ask the landlord to resend it from
          their Proximity dashboard.
        </p>
      </>
    );
  }

  if (state === "done") {
    return shell(
      <>
        <h1 className="text-xl font-bold text-gray-900 mb-3">Address confirmed</h1>
        <p className="text-sm text-gray-600">
          New messages will be emailed to <span className="font-medium text-gray-900">{email}</span>.
          You can reply in the Proximity app or directly to those emails.
        </p>
      </>
    );
  }

  return shell(
    <>
      <h1 className="text-xl font-bold text-gray-900 mb-3">Confirm message alerts</h1>
      <p className="text-sm text-gray-600 mb-2">
        <span className="font-medium text-gray-900">{landlordName || "A landlord"}</span> wants
        students&apos; messages sent to <span className="font-medium text-gray-900">{email}</span>.
      </p>
      <p className="text-xs text-gray-500 mb-6">
        The conversations stay in their Proximity inbox. This address gets an email for each new
        message and can reply to it.
      </p>
      {state === "error" && (
        <p className="text-sm text-red-600 mb-4">Something went wrong. Please try again.</p>
      )}
      <button
        type="button"
        disabled={state === "busy"}
        onClick={confirm}
        className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition disabled:opacity-60"
      >
        {state === "busy" ? "Confirming…" : "Confirm this address"}
      </button>
    </>
  );
}
