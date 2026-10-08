"use client";

/*
 * "..." menu in the conversation header with Report and Block. Report asks for one
 * of the fixed reasons; Block asks for confirmation. Both are thread-level: the
 * server works out who the other person is. A blocked conversation leaves this
 * user's inbox (MessagesContext.blockThread closes it).
 */
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { CHAT_REPORT_REASONS } from "@proximity/shared";
import Modal from "@/components/ui/Modal";
import { useMessages } from "@/context/MessagesContext";

export default function ChatSafetyMenu({ thread }) {
  const { blockThread, reportThread } = useMessages();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // "report" | "block" | null
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (!thread?.threadId) return null;

  const name = thread.otherUserName || "this person";

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setReason("");
  };

  const submitReport = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await reportThread(thread.threadId, { reason });
      toast.success("Report sent. Thanks, we'll take a look.");
      setDialog(null);
      setReason("");
    } catch (err) {
      toast.error(err?.message || "Couldn't send your report. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await blockThread(thread.threadId);
      toast.success("User blocked successfully.");
      setDialog(null);
    } catch (err) {
      toast.error(err?.message || "Couldn't block this user. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="relative flex-shrink-0" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 transition"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            &#8943;
          </span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDialog("report");
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Report
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDialog("block");
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-50"
            >
              Block
            </button>
          </div>
        )}
      </div>

      <Modal isOpen={dialog === "report"} onClose={closeDialog}>
        <div className="p-5">
          <h2 className="text-base font-bold text-gray-900 mb-1">Report {name}</h2>
          <p className="text-sm text-gray-500 mb-4">
            Tell us what is wrong. We will look at this conversation. {name} won&apos;t be
            told.
          </p>
          <div className="space-y-1.5 mb-4" role="radiogroup" aria-label="Reason">
            {CHAT_REPORT_REASONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
                  reason === option.value
                    ? "border-red-500 bg-red-50 text-gray-900"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="chat-report-reason"
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                  className="accent-red-600"
                />
                {option.label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={busy}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitReport}
              disabled={!reason || busy}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send report"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={dialog === "block"} onClose={closeDialog}>
        <div className="p-5">
          <h2 className="text-base font-bold text-gray-900 mb-1">Block {name}?</h2>
          <p className="text-sm text-gray-500 mb-4">
            This conversation will be removed from your inbox and neither of you will be
            able to message the other. Their reviews will also be hidden from you. To undo
            this, contact Proximity support at info@useproximity.org.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={busy}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmBlock}
              disabled={busy}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Blocking..." : "Block"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
