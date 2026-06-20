"use client";

/*
 * Site-wide bug-report / suggestion widget. Renders a small floating button in the
 * bottom-left corner (kept clear of the bottom-right ChatWidget) and a modal form.
 * Also opens when any element dispatches the `proximity:open-feedback` window event —
 * the footer "Report a bug" link uses that so both entry points share one modal.
 * Submissions POST to /api/feedback, which emails the team.
 */

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { MessageSquarePlus, X } from "lucide-react";

const TYPES = [
  { value: "bug", label: "🐞 Bug" },
  { value: "suggestion", label: "💡 Suggestion" },
  { value: "other", label: "💬 Other" },
];

export const OPEN_FEEDBACK_EVENT = "proximity:open-feedback";

export default function FeedbackWidget() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const openModal = useCallback(() => setOpen(true), []);

  // Let other parts of the app (e.g. the footer link) open this modal.
  useEffect(() => {
    window.addEventListener(OPEN_FEEDBACK_EVENT, openModal);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, openModal);
  }, [openModal]);

  function close() {
    if (submitting) return;
    setOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    if (message.trim().length < 5) {
      toast.error("Please add a little more detail.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message: message.trim(),
          email: session?.user?.email ? "" : email.trim(),
          pageUrl: typeof window !== "undefined" ? window.location.href : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.");
        return;
      }
      toast.success("Thanks! We got your note.");
      setMessage("");
      setEmail("");
      setType("bug");
      setOpen(false);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        type="button"
        onClick={openModal}
        aria-label="Report a bug or suggest a fix"
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full bg-gray-900 text-white shadow-lg hover:bg-gray-800 transition px-4 py-3"
      >
        <MessageSquarePlus className="h-5 w-5" />
        <span className="hidden sm:inline text-sm font-semibold">Feedback</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={close}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-bold text-gray-900">Report a bug or suggest a fix</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Spotted something broken or have an idea? Tell us — it goes straight to the team.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      type === t.value
                        ? "border-red-400 bg-red-50 text-red-700"
                        : "border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={
                  type === "bug"
                    ? "What went wrong? What were you trying to do?"
                    : "What would make Proximity better?"
                }
                className="w-full px-3 py-2.5 text-[15px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
              />

              {!session?.user?.email && (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email (optional, so we can follow up)"
                  className="w-full px-3 py-2.5 text-[15px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                />
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : "Send feedback"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
