"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

const STATUS_COLORS = {
  pending:  "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  edited:   "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-600",
};

function RedlineItem({ redline, isSelected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition hover:bg-gray-50
        ${isSelected ? "bg-red-50 border-l-2 border-l-red-500" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 truncate">{redline.section_label}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[redline.status] || "bg-gray-100 text-gray-500"}`}>
          {redline.status}
        </span>
      </div>
      <p className="text-xs text-gray-400 truncate mt-0.5 line-through">{redline.original_text}</p>
    </button>
  );
}

function RedlinePanel({ redline, leaseId, onAction }) {
  const [editText, setEditText] = useState(redline.suggested_text);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditText(redline.suggested_text);
    setEditMode(false);
  }, [redline.id]);

  const act = async (action, text) => {
    setSaving(true);
    const res = await fetch(`/api/landlord/executed-leases/${leaseId}/redlines/${redline.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, edited_text: text }),
    });
    setSaving(false);
    if (res.ok) { toast.success("Redline updated"); onAction(); }
    else { const d = await res.json(); toast.error(d.error || "Failed"); }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-5 flex-1">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Section</p>
          <p className="text-sm font-medium text-gray-900">{redline.section_label}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Original text</p>
          <p className="text-sm text-red-700 line-through bg-red-50 rounded-lg px-3 py-2 leading-relaxed">
            {redline.original_text}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {editMode ? "Your edit" : "AI suggestion"}
          </p>
          {editMode ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2 leading-relaxed">
              {redline.suggested_text}
            </p>
          )}
        </div>

        {redline.rationale && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI rationale</p>
            <p className="text-sm text-gray-600 leading-relaxed">{redline.rationale}</p>
          </div>
        )}

        {redline.ai_confidence != null && (
          <p className="text-xs text-gray-400">
            AI confidence: {Math.round(redline.ai_confidence * 100)}%
          </p>
        )}

        <p className="text-xs text-gray-400 italic border-t border-gray-100 pt-3">
          * Green text is AI-adjusted based on your chat logs and approved by you.{" "}
          <Link href="/privacy" className="underline hover:text-gray-600">See our privacy policy.</Link>
        </p>
      </div>

      {redline.status === "pending" && (
        <div className="border-t border-gray-200 p-4 space-y-2">
          {!editMode ? (
            <div className="flex gap-2">
              <button onClick={() => act("approve")} disabled={saving}
                className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                Approve as-is
              </button>
              <button onClick={() => setEditMode(true)} disabled={saving}
                className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition">
                Edit & approve
              </button>
              <button onClick={() => act("reject")} disabled={saving}
                className="px-4 py-2 text-red-600 text-sm font-medium hover:text-red-700 disabled:opacity-50 transition">
                Reject
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => act("edit", editText)} disabled={saving || !editText.trim()}
                className="flex-1 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                {saving ? "Saving…" : "Save edit"}
              </button>
              <button onClick={() => setEditMode(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeaseVaultReviewPage() {
  const { id } = useParams();
  const router = useRouter();
  const [lease, setLease] = useState(null);
  const [redlines, setRedlines] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedRedline, setSelectedRedline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [sending, setSending] = useState(false);
  const chatBottomRef = useRef(null);

  const refresh = async () => {
    const [leaseRes, redlineRes] = await Promise.all([
      fetch(`/api/landlord/executed-leases/${id}`),
      fetch(`/api/landlord/executed-leases/${id}/redlines`),
    ]);
    if (leaseRes.ok) {
      const l = await leaseRes.json();
      setLease(l);
      if (l.chat_thread_id) {
        const msgRes = await fetch(`/api/chat/threads/${l.chat_thread_id}/messages`);
        if (msgRes.ok) setMessages(await msgRes.json());
      }
    }
    if (redlineRes.ok) {
      const r = await redlineRes.json();
      setRedlines(r);
      if (r.length > 0 && !selectedRedline) setSelectedRedline(r[0]);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [id]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const proposeFromChat = async () => {
    setProposing(true);
    const res = await fetch(`/api/landlord/executed-leases/${id}/redlines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "propose_from_chat" }),
    });
    setProposing(false);
    if (res.ok) { toast.success("Redlines proposed from chat"); await refresh(); }
    else { const d = await res.json(); toast.error(d.error || "Failed to propose redlines"); }
  };

  const sendToTenant = async () => {
    setSending(true);
    const res = await fetch(`/api/landlord/executed-leases/${id}/send-to-tenant`, { method: "POST" });
    setSending(false);
    if (res.ok) { toast.success("Sent to tenant for signature"); router.push("/dashboard/landlord?view=lease-vault"); }
    else { const d = await res.json(); toast.error(d.error || "Failed"); }
  };

  const pendingCount = redlines.filter((r) => r.status === "pending").length;
  const canSend = lease?.status === "landlord_approved" && pendingCount === 0 && lease?.executed_lease_tenants?.length > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
        Lease not found.{" "}
        <Link href="/dashboard/landlord?view=lease-vault" className="text-red-600 underline ml-1">Back</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-20">
        <Link href="/dashboard/landlord?view=lease-vault"
          className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1">
          ← Lease Vault
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <p className="text-sm font-semibold text-gray-900 truncate flex-1">
          Review redlines
        </p>
        {pendingCount > 0 && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
            {pendingCount} pending
          </span>
        )}
        {lease.chat_thread_id && (
          <button onClick={proposeFromChat} disabled={proposing}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition">
            {proposing ? "Proposing…" : "Refresh AI redlines"}
          </button>
        )}
      </div>

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-0 overflow-hidden" style={{ height: "calc(100vh - 105px)" }}>

        {/* Left: Chat thread */}
        <div className="lg:col-span-1 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chat history</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No messages in this thread.</p>
            ) : messages.map((m) => (
              <div key={m.id} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 mb-1">{new Date(m.created_at).toLocaleString()}</p>
                <p className="text-gray-800 leading-relaxed">{m.body}</p>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        </div>

        {/* Center: Redline list */}
        <div className="lg:col-span-1 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Redlines</p>
            <span className="text-xs text-gray-400">{redlines.length} total</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {redlines.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center gap-3">
                <p className="text-sm text-gray-400">No redlines yet.</p>
                {lease.chat_thread_id && (
                  <button onClick={proposeFromChat} disabled={proposing}
                    className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                    {proposing ? "Proposing…" : "Propose from chat"}
                  </button>
                )}
              </div>
            ) : redlines.map((r) => (
              <RedlineItem
                key={r.id}
                redline={r}
                isSelected={selectedRedline?.id === r.id}
                onClick={() => setSelectedRedline(r)}
              />
            ))}
          </div>
        </div>

        {/* Right: Redline detail panel */}
        <div className="lg:col-span-2 bg-white flex flex-col overflow-hidden">
          {selectedRedline ? (
            <RedlinePanel
              key={selectedRedline.id}
              redline={redlines.find((r) => r.id === selectedRedline.id) || selectedRedline}
              leaseId={id}
              onAction={refresh}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              Select a redline to review
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {pendingCount > 0
            ? `${pendingCount} redline${pendingCount !== 1 ? "s" : ""} still need your decision`
            : redlines.length > 0
            ? "All redlines reviewed ✓"
            : "No redlines"}
          {!lease.executed_lease_tenants?.length && (
            <span className="ml-3 text-yellow-600">· Add a tenant before sending</span>
          )}
        </div>
        <button
          onClick={sendToTenant}
          disabled={!canSend || sending}
          className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-40 transition"
        >
          {sending ? "Sending…" : "Approve all & send to tenant →"}
        </button>
      </div>
    </div>
  );
}
