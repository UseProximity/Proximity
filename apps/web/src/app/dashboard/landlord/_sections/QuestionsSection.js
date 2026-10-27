"use client";

/*
 * Questions from students, sent on by Proxy (PRD v3).
 *
 * A landlord never sees who asked: each card carries the question, which
 * lease it is about and whether the student was signed in, and how many
 * students are waiting on it. "Send answer" goes back to every one of them
 * through Proxy and is saved to the listing's knowledge, so the question is
 * not asked again. "Ask the student" relays a clarifying question instead.
 * Phone numbers, emails and links are removed from anything sent.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageCircleQuestion, CheckCircle2 } from "lucide-react";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

function QuestionCard({ q, onDone, viewAsId = null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (done) => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/questions/${q.id}${qs}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, done }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not send that."); return; }
      toast.success(done
        ? `Sent to ${data.relayedTo === 1 ? "the student" : `${data.relayedTo} students`}${data.saved?.written ? " and saved to your listing's knowledge" : ""}.`
        : "Sent to the student.");
      if (data.screened) toast("Contact details were removed before sending.", { icon: "ℹ️" });
      setText("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-500">
        <span>{q.context}{q.askedCount > 1 ? ` · ${q.askedCount} students waiting` : ""}</span>
        <span>{when(q.createdAt)}</span>
      </div>
      <p className="text-sm font-medium text-gray-900">{q.question}</p>
      {q.exchange?.length > 0 && (
        <div className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-xs text-gray-600">
          {q.exchange.map((m, i) => (
            <p key={i}><span className="font-semibold">{m.sender === "landlord" ? "You" : m.sender === "student" ? "The student" : "Proxy"}:</span> {m.body}</p>
          ))}
        </div>
      )}
      {q.pendingClarifier && <p className="mt-2 text-xs text-amber-700">Waiting on the student&apos;s reply.</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Your answer. It goes back to the student through Proxy and is saved so you are not asked again."
        className="mt-3 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={() => submit(true)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send answer</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => submit(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Ask the student something first</button>
      </div>
    </div>
  );
}

export default function QuestionsSection({ viewAsId = null }) {
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/questions${qs}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Could not load questions");
      setQuestions(data.questions ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [viewAsId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!questions) return <div className="py-8 text-center text-sm text-gray-400">Loading questions...</div>;

  const open = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered");
  const byListing = (list) => {
    const groups = new Map();
    for (const q of list) {
      if (!groups.has(q.listingId)) groups.set(q.listingId, { title: q.listingTitle, items: [] });
      groups.get(q.listingId).items.push(q);
    }
    return [...groups.values()];
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Proxy, the assistant on your listings, answers students from what it knows and sends you only what it can&apos;t. Your answer goes back through Proxy and is saved, so you are never asked the same thing twice. Phone numbers, emails and links are removed; students get your contact details when they book a tour.
      </p>

      {open.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
          <MessageCircleQuestion className="h-5 w-5 text-gray-400" /> No open questions. Proxy has handled everything so far.
        </div>
      ) : (
        byListing(open).map((g) => (
          <section key={g.title} className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">{g.title} <span className="font-normal text-gray-500">({g.items.length} open)</span></h3>
            {g.items.map((q) => <QuestionCard key={q.id} q={q} onDone={load} viewAsId={viewAsId} />)}
          </section>
        ))
      )}

      {answered.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Answered</h3>
          {answered.slice(0, 30).map((q) => (
            <div key={q.id} className="rounded-xl border border-gray-100 bg-white p-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {q.listingTitle} · {when(q.answeredAt)} · saved to the listing&apos;s knowledge
              </div>
              <p className="mt-1 text-gray-900">{q.question}</p>
              <p className="mt-1 text-gray-600">{q.answer}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
