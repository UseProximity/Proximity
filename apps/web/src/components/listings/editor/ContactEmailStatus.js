"use client";

/*
 * Under a contact email field: whether this address is confirmed for message
 * alerts, and what that means.
 *
 * An address only starts receiving chat alerts once someone at it clicks the
 * confirmation link (lib/chat/contactVerification). Until then alerts go to the
 * landlord's account email, and the conversations live in the account's inbox
 * either way. Both facts are spelled out here because a landlord setting a
 * leasing office address needs to know where students' messages will go.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";

const COPY = {
  confirmed: "Confirmed. New message alerts for this listing go here.",
  pending:
    "Waiting for confirmation. We emailed a link to this address. Until someone clicks it, alerts go to your account email.",
  unconfirmed:
    "Not confirmed yet. Until it is, alerts go to your account email.",
};

export default function ContactEmailStatus({ savedEmail, draftEmail }) {
  const saved = (savedEmail || "").trim().toLowerCase();
  const draft = (draftEmail || "").trim().toLowerCase();
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    // The confirmation email is sent just after the save responds, so a status
    // read straight away can still say "unconfirmed". One short wait covers it.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/landlord/contact-emails?emails=${encodeURIComponent(saved)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setStatus(data?.statuses?.[saved] ?? null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [saved]);

  const resend = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/landlord/contact-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: saved }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't send the link.");
      if (data.status === "confirmed") {
        setStatus("confirmed");
      } else if (data.status === "skipped") {
        toast("A link was sent a few minutes ago. Check that inbox.");
      } else {
        setStatus("pending");
        toast.success(`Confirmation link sent to ${saved}.`);
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setSending(false);
    }
  };

  let line;
  if (draft && draft !== saved) {
    line = <>After you save, we&apos;ll email this address a link to confirm it.</>;
  } else if (status) {
    line = (
      <>
        <span className={status === "confirmed" ? "text-green-600" : "text-amber-600"}>
          {COPY[status]}
        </span>
        {status !== "confirmed" && (
          <button
            type="button"
            onClick={resend}
            disabled={sending}
            className="ml-1 font-medium text-red-600 hover:underline disabled:opacity-60"
          >
            {sending ? "Sending…" : status === "pending" ? "Resend link" : "Send link"}
          </button>
        )}
      </>
    );
  }

  return (
    <span className="mt-0.5 block text-[11px] leading-snug text-gray-400">
      {line && <span className="block">{line}</span>}
      <span className="block">
        Message alerts go to this address. Conversations stay in your Proximity inbox.
      </span>
    </span>
  );
}
