"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import ChatWindow from "./ChatWindow";
import PreferencePanel from "./PreferencePanel";
import { applyAnswer, nextQuestion, answerToLabel, describeQuestion, rewindTo } from "@/lib/matchmaking/questionEngine";
import { QUESTION_BY_ID, QUESTION_PLAN, MAX_TRADEOFFS } from "@/lib/matchmaking/questionScript";
import { defaultInquiryNote } from "@/lib/matchmaking/contactNote";
import { trackEvent, getPreviousPath } from "@/utils/analytics";

const LS_KEY = "prx_chat_v2";

function saveToStorage(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Build an assistant chat message that carries a question descriptor (renders
// chips). `animate` triggers the typing effect for freshly-sent questions.
function questionToMessage(q, animate = false) {
  return { role: "assistant", content: q.prompt, ts: new Date().toISOString(), question: q, animate };
}

// Identity for the "don't repeat the latest question" guard. Consecutive
// narrowing tradeoffs all share the id "tradeoff", so fold in the per-question
// stepKey to keep them distinct.
const qKey = (q) => (q ? `${q.id}:${q.meta?.stepKey ?? ""}` : "");

// Progress-bar shape: the scripted questions fill 0→90%; the narrowing phase
// ("Would you X for Y?" tradeoffs) starts at 90% and steps toward — but never
// reaches — 100% until the matches are in. The step is sized against the
// WORST-CASE number of remaining questions (MAX_TRADEOFFS tradeoffs plus the
// possible commute check) so the bar never has to stall or move backward when
// another question arrives, with a 3-point floor so each answer visibly moves it.
const NARROWING_START = 0.9;
const NARROWING_STEP = Math.max(0.03, (1 - NARROWING_START) / (MAX_TRADEOFFS + 1));

export default function ChatClient() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [preferences, setPreferences] = useState({});
  const [weights, setWeights] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [status, setStatus] = useState("in_progress");
  const [loading, setLoading] = useState(false);
  const [recsUpdating, setRecsUpdating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // The chat API requires a signed-in user in production (401). Without this the
  // screen rendered an empty, unanswerable chat — show a sign-in card instead.
  const [needsAuth, setNeedsAuth] = useState(false);
  const hadCache = useRef(false);

  // Refs mirror the latest prefs/weights so rapid chip taps build on current
  // state even before React re-renders. postChain serializes POSTs so the
  // server never sees out-of-order, stale writes (which caused re-asked questions).
  const prefsRef = useRef({});
  const weightsRef = useRef({});
  const postChain = useRef(Promise.resolve());
  // Maps the contact question's option labels (each match's intention tag) back to
  // its listing id, so a selection can be turned into the listings to email.
  const contactMapRef = useRef({});
  useEffect(() => {
    prefsRef.current = preferences;
  }, [preferences]);
  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

  // Analytics refs — mirror flow position so the exit listener (bound once) can
  // report exactly where the user was when they left.
  const statusRef = useRef("in_progress");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // "none" → contact offer not yet answered; "offer_answered"; "sent"
  const contactStageRef = useRef("none");
  const lastHiddenStageRef = useRef(null);

  // Where the user currently is in the flow, for exit/abandonment events.
  const currentStage = useCallback(() => {
    if (statusRef.current === "recommendations_ready") {
      if (contactStageRef.current === "sent") return { stage: "contact_sent" };
      if (contactStageRef.current === "offer_answered") return { stage: "post_contact_offer" };
      return { stage: "recommendations" };
    }
    const upcoming = nextQuestion(prefsRef.current);
    if (!upcoming) return { stage: "narrowing" };
    const idx = QUESTION_PLAN.findIndex((q) => q.id === upcoming.id);
    return { stage: upcoming.id, step: idx + 1, totalSteps: QUESTION_PLAN.length };
  }, []);

  // Entry event + exit beacon. "hidden" = tab switched/minimized (deduped per
  // stage so tab-flippers don't spam); "leave" = tab closed or hard navigation;
  // "navigate" = client-side navigation to another page (unmount).
  useEffect(() => {
    trackEvent("Matchmaking Opened", { from: getPreviousPath("/matchmaking") });

    const fireExit = (type) => {
      const info = currentStage();
      if (type === "hidden") {
        if (lastHiddenStageRef.current === info.stage) return;
        lastHiddenStageRef.current = info.stage;
      }
      trackEvent("Proxy Chat Exited", { ...info, type });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") fireExit("hidden");
    };
    const onPageHide = () => fireExit("leave");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      fireExit("navigate");
    };
  }, [currentStage]);

  // Persist chat state to localStorage on every meaningful change
  useEffect(() => {
    if (messages.length > 0 && sessionId) {
      saveToStorage({ messages, sessionId, preferences, weights, recommendations, status });
    }
  }, [messages, sessionId, preferences, weights, recommendations, status]);

  // Mirror the visible chat back to the server. Several turns are authored only
  // on the client (the "want me to email these owners?" offer, a declined offer,
  // an email draft), and a reload rebuilds the window from the STORED transcript,
  // so without this those turns disappear. Debounced, and pushed through
  // postChain so it can never overtake an in-flight turn.
  useEffect(() => {
    if (!sessionId || messages.length === 0 || loading) return;
    const id = setTimeout(() => {
      const transcript = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        ...(m.question ? { question: m.question } : {}),
        ...(m.questionId ? { questionId: m.questionId } : {}),
        ...(m.tradeoffIndex != null ? { tradeoffIndex: m.tradeoffIndex } : {}),
        ...(m.recommendations ? { recommendations: m.recommendations } : {}),
        ...(m.draft ? { draft: m.draft } : {}),
      }));
      postChain.current = postChain.current.then(() =>
        fetch("/api/matchmaking/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, action: "save_transcript", transcript }),
        }).catch((err) => console.error("[ChatClient] transcript save failed:", err))
      );
    }, 800);
    return () => clearTimeout(id);
  }, [messages, sessionId, loading]);

  const applyServerState = useCallback((data) => {
    if (data.sessionId) setSessionId(data.sessionId);
    if (data.preferences) setPreferences(data.preferences);
    if (data.weights) setWeights(data.weights);
    if (data.recommendations) setRecommendations(data.recommendations);
    if (data.status) setStatus(data.status);
  }, []);

  // Apply ONLY ranking/status from a server response — never prefs/weights/
  // messages, which the client owns optimistically during the question flow.
  const applyRanking = useCallback((data) => {
    if (data.recommendations) setRecommendations(data.recommendations);
    if (data.status) setStatus(data.status);
  }, []);

  const inlineRecsMessage = (data) => ({
    role: "assistant",
    content: data.assistantMessage || "Here are your top matches:",
    ts: new Date().toISOString(),
    recommendations: data.recommendations,
    animate: true,
  });

  // Build the "want me to reach out to any of these owners?" question that follows
  // the matches — a multi-select whose options are each pick's listing title. Also
  // refreshes the label→listing map the send handler reads. Returns null if no recs.
  const buildContactMessage = useCallback((recommendations, animate = true) => {
    const recs = (recommendations ?? []).filter((r) => r?.listing_id);
    if (!recs.length) return null;
    // Label each option by its listing title (fall back to address / intention),
    // de-duping so two identical titles still map to distinct options.
    const seen = new Map();
    const options = recs.map((r) => {
      const base = (r.card_data?.title || r.card_data?.address || r.intention || "Listing").trim();
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base} (${n + 1})`;
    });
    contactMapRef.current = Object.fromEntries(recs.map((r, i) => [options[i], r.listing_id]));
    return questionToMessage(
      {
        id: "contact_owners",
        kind: "contact",
        prompt: "Want me to reach out to any of these owners for you? I'll email them and CC you. Pick all that apply.",
        options,
        meta: { contact: true },
      },
      animate
    );
  }, []);

  // Append the matches followed by the contact offer in one update.
  const appendRecsWithContact = useCallback(
    (data) => {
      trackEvent("Proxy Recommendations Shown", { count: data.recommendations?.length ?? 0 });
      setMessages((prev) => {
        const next = [...prev, inlineRecsMessage(data)];
        const contact = buildContactMessage(data.recommendations);
        if (contact) next.push(contact);
        return next;
      });
    },
    [buildContactMessage]
  );

  // Append an editable email-draft message (used by both the multi-select offer
  // and the agent when the user asks Proxy to email an owner mid-conversation).
  const appendDraftMessage = useCallback((content, { listingIds, recipientsLabel, message }) => {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content,
        ts: new Date().toISOString(),
        animate: true,
        draft: {
          draftId: String(Date.now()),
          listingIds,
          recipientsLabel,
          selectionLabel: `Reach out to: ${recipientsLabel}`,
          message,
        },
      },
    ]);
  }, []);

  // The student answered the contact offer. Instead of sending right away, Proxy
  // shows an editable draft of the note (one shared message for the owners they
  // picked); nothing goes out until they hit send (handleSendDraft).
  const handleContactOwners = useCallback(
    (answer) => {
      const labels = Array.isArray(answer.value) ? answer.value : [];
      const listingIds = labels.map((l) => contactMapRef.current[l]).filter(Boolean);
      const selectionLabel = labels.length ? `Reach out to: ${labels.join(", ")}` : "No thanks";
      contactStageRef.current = "offer_answered";
      trackEvent("Proxy Contact Offer Answered", { selected: listingIds.length });
      setMessages((prev) => [...prev, { role: "user", content: selectionLabel, ts: new Date().toISOString() }]);

      if (!listingIds.length) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "No problem, I can always reach out later. In the meantime, want me to fine-tune your matches, compare these places, or dig into the details on any of them? Just say the word.",
            ts: new Date().toISOString(),
            animate: true,
          },
        ]);
        return;
      }

      const defaultNote = defaultInquiryNote(prefsRef.current?.name);
      const recipientsLabel = labels.join(" & ");

      appendDraftMessage(
        `Here's the note I'll send to the owner${listingIds.length > 1 ? "s" : ""} of ${recipientsLabel}. Edit anything you'd like, then hit send and I'll reach out (and CC you).`,
        { listingIds, recipientsLabel, message: defaultNote }
      );
    },
    [appendDraftMessage]
  );

  // Send the (possibly edited) draft. Marks the draft sent in place, then asks the
  // server to email each selected owner with the student's note.
  const handleSendDraft = useCallback(
    (draft, message) => {
      const { draftId, listingIds, selectionLabel } = draft;
      setMessages((prev) =>
        prev.map((m) => (m.draft?.draftId === draftId ? { ...m, draft: { ...m.draft, message, sent: true } } : m))
      );
      setLoading(true);
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, action: "contact_owners", listingIds, message, selectionLabel }),
          });
          const data = await res.json();
          if (res.ok) {
            contactStageRef.current = "sent";
            trackEvent("Proxy Contact Email Sent", { listings: listingIds.length });
          }
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: res.ok
                ? data.assistantMessage || "Done! I've reached out on your behalf."
                : "I couldn't reach out just now, please try again in a bit.",
              ts: new Date().toISOString(),
              animate: true,
            },
          ]);
        } catch (err) {
          console.error("[ChatClient] handleSendDraft failed:", err);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Something went wrong reaching out, please try again.", ts: new Date().toISOString(), animate: true },
          ]);
        } finally {
          setLoading(false);
        }
      });
    },
    [sessionId]
  );

  // Tradeoff answer — a "Would you X for Y?" narrowing pick. The server owns this
  // phase (it needs live listing data), so unlike scripted chips this is NOT
  // optimistic: we post the choice and append whatever comes back (the next
  // tradeoff, or the final recommendations).
  const handleTradeoffAnswer = useCallback(
    (answer) => {
      trackEvent("Proxy Question Answered", { questionId: "tradeoff", kind: "tradeoff", answer: answerToLabel(answer) });
      // Stamp the tradeoff's position so this bubble gets an "Edit" affordance that
      // rewinds the narrowing phase to exactly this question (see handleEditFrom).
      const tradeoffIndex = prefsRef.current?._tradeoffHistory?.length ?? 0;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: answerToLabel(answer), ts: new Date().toISOString(), questionId: "tradeoff", tradeoffIndex },
      ]);
      setLoading(true);
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              tradeoff: { chosen: answer.value },
              preferences: prefsRef.current,
              weights: weightsRef.current,
            }),
          });
          const data = await res.json();
          if (res.ok) {
            applyRanking(data);
            if (data.preferences) {
              setPreferences(data.preferences);
              prefsRef.current = data.preferences;
            }
            if (data.weights) {
              setWeights(data.weights);
              weightsRef.current = data.weights;
            }
            if (data.nextQuestion) {
              setMessages((prev) =>
                qKey(prev[prev.length - 1]?.question) === qKey(data.nextQuestion)
                  ? prev
                  : [...prev, questionToMessage(data.nextQuestion, true)]
              );
            } else if (data.recommendations?.length) {
              appendRecsWithContact(data);
            }
          }
        } catch (err) {
          console.error("[ChatClient] handleTradeoffAnswer failed:", err);
        } finally {
          setLoading(false);
        }
      });
    },
    [sessionId, applyRanking, appendRecsWithContact]
  );

  // Chip answer — render the next question instantly (optimistic); the POST just
  // persists + ranks in the background. Client is authoritative for the flow.
  const handleAnswer = useCallback(
    (answer) => {
      // Tradeoff narrowing is server-driven — route it out of the optimistic path.
      if (answer.kind === "tradeoff") {
        handleTradeoffAnswer(answer);
        return;
      }
      // The "contact owners" offer is its own server-driven path (sends email).
      if (answer.kind === "contact") {
        handleContactOwners(answer);
        return;
      }
      const applied = applyAnswer(prefsRef.current, weightsRef.current, answer);
      const upcoming = nextQuestion(applied.preferences);

      const stepIdx = QUESTION_PLAN.findIndex((q) => q.id === answer.questionId);
      trackEvent("Proxy Question Answered", {
        questionId: answer.questionId,
        kind: "scripted",
        step: stepIdx + 1,
        totalSteps: QUESTION_PLAN.length,
        // The name question's label contains the student's name — keep it out of analytics.
        ...(answer.questionId === "name_confirm" ? {} : { answer: answerToLabel(answer) }),
      });

      prefsRef.current = applied.preferences;
      weightsRef.current = applied.weights;
      setPreferences(applied.preferences);
      setWeights(applied.weights);
      setMessages((prev) => {
        // Stamp the question this answer belongs to so the user's own bubble can
        // carry an "Edit" affordance that rewinds the flow to this point.
        const next = [...prev, { role: "user", content: answerToLabel(answer), ts: new Date().toISOString(), questionId: answer.questionId }];
        // Guard against repeating a question that's already the latest one.
        if (upcoming && qKey(prev[prev.length - 1]?.question) !== qKey(upcoming)) {
          next.push(questionToMessage(upcoming, true));
        }
        return next;
      });

      const finalizing = !upcoming;
      if (finalizing) setLoading(true); // ranking the 3 picks is the only wait

      const snapshot = { preferences: applied.preferences, weights: applied.weights };
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, answer, ...snapshot }),
          });
          const data = await res.json();
          if (res.ok) {
            applyRanking(data);
            if (finalizing) {
              // Carry the server's hidden narrowing state (pending tradeoff,
              // exclusions) so subsequent posts stay in sync.
              if (data.preferences) {
                setPreferences(data.preferences);
                prefsRef.current = data.preferences;
              }
              if (data.weights) {
                setWeights(data.weights);
                weightsRef.current = data.weights;
              }
              // After the last scripted answer the server either opens the
              // narrowing phase with a tradeoff question, or (≤3 fits) returns
              // the final picks.
              if (data.nextQuestion) {
                setMessages((prev) =>
                  qKey(prev[prev.length - 1]?.question) === qKey(data.nextQuestion)
                    ? prev
                    : [...prev, questionToMessage(data.nextQuestion, true)]
                );
              } else if (data.recommendations?.length) {
                appendRecsWithContact(data);
              }
            }
          }
        } catch (err) {
          console.error("[ChatClient] handleAnswer failed:", err);
        } finally {
          if (finalizing) setLoading(false);
        }
      });
    },
    [sessionId, applyRanking, handleTradeoffAnswer, handleContactOwners, appendRecsWithContact]
  );

  // Free-text composer — parses an answer mid-flow, or refines the picks after
  // recommendations are ready. Server interprets; we append its reply.
  const handleUserSend = useCallback(
    (text) => {
      // Track that a free-text message was sent (never its content).
      trackEvent("Proxy Message Sent", {
        mode: statusRef.current === "recommendations_ready" ? "refine" : "flow",
      });
      setMessages((prev) => [...prev, { role: "user", content: text, ts: new Date().toISOString() }]);
      setLoading(true);
      const snapshot = { preferences: prefsRef.current, weights: weightsRef.current };
      postChain.current = postChain.current.then(async () => {
        try {
          const res = await fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, message: text, ...snapshot }),
          });
          const data = await res.json();
          if (res.ok) {
            applyRanking(data);
            if (data.preferences) {
              setPreferences(data.preferences);
              prefsRef.current = data.preferences;
            }
            if (data.weights) {
              setWeights(data.weights);
              weightsRef.current = data.weights;
            }
            if (data.mode === "agent") {
              // The re-rank found nothing the student hasn't already seen. Proxy
              // says so (fixed text), then we immediately run the widening turn —
              // the dots stay up while it loosens the filters and re-ranks.
              if (data.pendingRelax) {
                trackEvent("Proxy Search Widened", {});
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString(), animate: true },
                ]);
                const retry = await fetch("/api/matchmaking/chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId, action: "relax_retry" }),
                });
                const widened = await retry.json();
                if (retry.ok) {
                  applyRanking(widened);
                  if (widened.preferences) {
                    setPreferences(widened.preferences);
                    prefsRef.current = widened.preferences;
                  }
                  if (widened.reranked && widened.recommendations?.length) {
                    appendRecsWithContact(widened);
                  } else if (widened.assistantMessage) {
                    setMessages((prev) => [
                      ...prev,
                      { role: "assistant", content: widened.assistantMessage, ts: new Date().toISOString(), animate: true },
                    ]);
                  }
                }
                return;
              }
              // Post-recommendations conversational turn. Re-rank → show new
              // matches; draft → editable email compose; otherwise a plain reply.
              if (data.reranked && data.recommendations?.length) {
                appendRecsWithContact(data);
              } else if (data.draft?.listingIds?.length) {
                appendDraftMessage(data.assistantMessage || "Here's a draft, edit and send when ready:", data.draft);
              } else if (data.assistantMessage) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString(), animate: true },
                ]);
              }
            } else if (data.nextQuestion) {
              // `note` is a standalone remark Proxy makes before asking the next
              // question (e.g. "a group your size takes a couple of units") — its
              // own bubble, so it doesn't get mixed into the question text.
              const note = data.note
                ? [{ role: "assistant", content: data.note, ts: new Date().toISOString(), animate: true }]
                : [];
              setMessages((prev) =>
                qKey(prev[prev.length - 1]?.question) === qKey(data.nextQuestion)
                  ? prev
                  : [...prev, ...note, questionToMessage(data.nextQuestion, true)]
              );
            } else if (data.recommendations?.length) {
              appendRecsWithContact(data);
            }
          }
        } catch (err) {
          console.error("[ChatClient] handleUserSend failed:", err);
        } finally {
          setLoading(false);
        }
      });
    },
    [sessionId, applyRanking, appendRecsWithContact, appendDraftMessage]
  );

  useEffect(() => {
    async function init() {
      // 1. Restore from localStorage immediately — no loading flash
      const cached = loadFromStorage();
      if (cached?.messages?.length) {
        // Restored bubbles must never re-run the typewriter — strip the flag.
        setMessages(cached.messages.map((m) => (m.animate ? { ...m, animate: false } : m)));
        if (cached.sessionId) setSessionId(cached.sessionId);
        if (cached.preferences) setPreferences(cached.preferences);
        if (cached.weights) setWeights(cached.weights);
        if (cached.recommendations) setRecommendations(cached.recommendations);
        if (cached.status) setStatus(cached.status);
        hadCache.current = true;
      } else {
        setLoading(true);
      }

      // 2. Sync with server (authoritative source). Ask for the session we were
      // last in by id — that's what lets an anonymous/guest tester resume, since
      // guests share one identity and can't be handed "their latest session".
      try {
        const res = await fetch(
          cached?.sessionId
            ? `/api/matchmaking/chat?sessionId=${encodeURIComponent(cached.sessionId)}`
            : "/api/matchmaking/chat"
        );
        if (res.status === 401) {
          // Anonymous in production — a cached transcript can't be continued either.
          localStorage.removeItem(LS_KEY);
          setMessages([]);
          setNeedsAuth(true);
          setLoading(false);
          return;
        }
        const { session } = await res.json();

        if (session) {
          // Transcript messages already carry their `question` descriptor.
          const serverMessages = (session.transcript ?? []).map((m) => ({
            role: m.role,
            content: m.content,
            ts: m.ts,
            ...(m.question ? { question: m.question } : {}),
            ...(m.questionId ? { questionId: m.questionId } : {}),
            ...(m.tradeoffIndex != null ? { tradeoffIndex: m.tradeoffIndex } : {}),
            ...(m.recommendations ? { recommendations: m.recommendations } : {}),
            ...(m.draft ? { draft: m.draft } : {}),
          }));
          // A pre-rework session has messages but none carry a `question`
          // descriptor (no chips) — it can't be answered. Restart it cleanly.
          const isStaleOldChat =
            session.status !== "recommendations_ready" &&
            serverMessages.length > 0 &&
            !serverMessages.some((m) => m.question);
          if (isStaleOldChat) {
            await startFresh();
            return;
          }

          setSessionId(session.id);
          setPreferences(session.preferences ?? {});
          setWeights(session.weights ?? {});
          setRecommendations(session.recommendations ?? []);
          setStatus(session.status);
          if (serverMessages.length > 0) {
            // If the matches are the last thing shown (the offer hasn't been answered
            // yet), re-add the "contact owners?" question so a reload still offers it.
            const last = serverMessages[serverMessages.length - 1];
            if (session.status === "recommendations_ready" && last?.recommendations) {
              const contact = buildContactMessage(session.recommendations, false);
              setMessages(contact ? [...serverMessages, contact] : serverMessages);
            } else {
              setMessages(serverMessages);
            }
          } else if (!hadCache.current) {
            await startFresh();
            return;
          }
          setLoading(false);
        } else if (!hadCache.current) {
          await startFresh();
        } else {
          // The server has no session to hand back, but we restored a real
          // transcript from this browser — keep it. (Wiping it here is what used
          // to nuke a guest tester's whole chat on reload.)
          setLoading(false);
        }
      } catch (err) {
        console.error("[ChatClient] serverSync failed:", err);
        setLoading(false);
      }
    }

    async function startFresh() {
      trackEvent("Proxy Chat Started", { restart: false });
      setLoading(true);
      try {
        const res = await fetch("/api/matchmaking/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "" }),
        });
        if (res.status === 401) {
          setNeedsAuth(true);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          applyServerState(data);
          setMessages([
            data.nextQuestion
              ? questionToMessage(data.nextQuestion, true)
              : { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
          ]);
        }
      } catch (err) {
        console.error("[ChatClient] startFresh failed:", err);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [applyServerState, buildContactMessage]);

  const handlePanelUpdate = useCallback(
    (data) => {
      applyServerState(data);
      // Cards live inside a chat message, so a panel re-rank (priorities reorder
      // after the picks exist) must refresh that message in place — otherwise the
      // visible cards go stale even though state updated.
      if (data.status === "recommendations_ready" && data.recommendations) {
        setMessages((prev) => {
          const rev = [...prev].reverse().findIndex((m) => m.recommendations);
          if (rev === -1) return prev;
          const idx = prev.length - 1 - rev;
          const copy = [...prev];
          copy[idx] = { ...copy[idx], recommendations: data.recommendations };
          return copy;
        });
      }
    },
    [applyServerState]
  );

  // Edit a past prompt: rewind prefs/weights to before that question, truncate
  // the chat back to it, and re-ask it (the user continues forward from there).
  const handleEditFrom = useCallback(
    (questionId, tradeoffIndex) => {
      // Tradeoff answers live in server-side narrowing state, so the server does
      // the rewind and hands back the question to re-ask.
      if (questionId === "tradeoff") {
        trackEvent("Proxy Answer Edited", { questionId: "tradeoff" });
        setStatus("in_progress");
        setRecommendations([]);
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === "user" && m.questionId === "tradeoff" && m.tradeoffIndex === tradeoffIndex);
          if (idx < 0) return prev;
          // Drop the answer and the question bubble that prompted it — the server
          // re-sends that question, so keeping it here would double it up.
          let cut = idx;
          while (cut > 0 && prev[cut - 1].role === "assistant") cut -= 1;
          return prev.slice(0, cut);
        });
        setLoading(true);
        postChain.current = postChain.current.then(async () => {
          try {
            const res = await fetch("/api/matchmaking/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, action: "rewind_tradeoff", tradeoffIndex }),
            });
            const data = await res.json();
            if (res.ok) {
              if (data.preferences) {
                setPreferences(data.preferences);
                prefsRef.current = data.preferences;
              }
              if (data.weights) {
                setWeights(data.weights);
                weightsRef.current = data.weights;
              }
              if (data.nextQuestion) {
                setMessages((prev) => [...prev, questionToMessage(data.nextQuestion, true)]);
              } else if (data.recommendations?.length) {
                appendRecsWithContact(data);
              }
            }
          } catch (err) {
            console.error("[ChatClient] rewind_tradeoff failed:", err);
          } finally {
            setLoading(false);
          }
        });
        return;
      }

      trackEvent("Proxy Answer Edited", { questionId });
      const rewound = rewindTo(prefsRef.current, questionId);
      prefsRef.current = rewound.preferences;
      weightsRef.current = rewound.weights;
      setPreferences(rewound.preferences);
      setWeights(rewound.weights);
      setStatus("in_progress");
      setRecommendations([]);

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.question?.id === questionId);
        const head = idx >= 0 ? prev.slice(0, idx) : prev;
        const descriptor = describeQuestion(QUESTION_BY_ID[questionId], rewound.preferences);
        const truncated = [...head, questionToMessage(descriptor, false)];

        // Persist the truncated transcript + rewound state so reloads stay consistent.
        postChain.current = postChain.current.then(() =>
          fetch("/api/matchmaking/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              action: "rewind",
              preferences: rewound.preferences,
              weights: rewound.weights,
              transcript: truncated,
            }),
          }).catch((err) => console.error("[ChatClient] rewind failed:", err))
        );

        return truncated;
      });
    },
    [sessionId, appendRecsWithContact]
  );

  // Abandon the current chat and begin a brand-new session from question one.
  const startOver = useCallback(async () => {
    trackEvent("Proxy Chat Started", { restart: true });
    contactStageRef.current = "none";
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setSessionId(null);
    setMessages([]);
    setPreferences({});
    setWeights({});
    setRecommendations([]);
    setStatus("in_progress");
    setLoading(true);
    try {
      const res = await fetch("/api/matchmaking/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });
      const data = await res.json();
      if (res.ok) {
        applyServerState(data);
        setMessages([
          data.nextQuestion
            ? questionToMessage(data.nextQuestion, true)
            : { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
        ]);
      }
    } catch (err) {
      console.error("[ChatClient] startOver failed:", err);
    } finally {
      setLoading(false);
    }
  }, [applyServerState]);

  // Flow progress for the header bar (see NARROWING_START/STEP above): scripted
  // position fills 0→90%, each answered tradeoff steps the bar up (capped at
  // 99%), and it hits 100% only when the matches are in.
  const progress = (() => {
    if (status === "recommendations_ready") return 1;
    const upcoming = nextQuestion(preferences);
    if (!upcoming) {
      const answered = preferences._tradeoffCount ?? 0;
      return Math.min(NARROWING_START + answered * NARROWING_STEP, 0.99);
    }
    const idx = QUESTION_PLAN.findIndex((q) => q.id === upcoming.id);
    return (Math.max(0, idx) / QUESTION_PLAN.length) * NARROWING_START;
  })();
  const progressPct = Math.round(progress * 100);

  // Signed-out: the chat can't run at all, so replace it with a sign-in card
  // rather than an empty window that never answers.
  if (needsAuth) {
    return (
      <div className="h-[calc(100svh-109px)] md:h-[calc(100svh-130px)] bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 text-lg font-bold flex items-center justify-center">
            P
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Sign in to chat with Proxy</h1>
          <p className="mt-2 text-sm text-gray-500">
            Answer a few quick questions and get free personalized off-campus housing matches near WashU.
          </p>
          <Link
            href="/login?callbackUrl=/matchmaking"
            className="mt-6 block w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
          >
            Sign in
          </Link>
          <Link
            href="/login?tab=signup&callbackUrl=/matchmaking"
            className="mt-3 inline-block text-sm font-medium text-gray-500 hover:text-red-600 transition"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  return (
    // Fill the viewport beneath the chrome above us so the chat is tall but the composer
    // stays on screen. Subtracts the sticky header (83px mobile / 104px desktop) plus the
    // ~26px localhost/staging banner; on production (no banner) this just leaves a small
    // gap above the footer. The footer sits below the fold.
    // svh, not dvh: sized to the SMALLEST viewport (mobile browser toolbars showing),
    // so the answer chips and composer at the bottom are never hidden behind them.
    <div className="h-[calc(100svh-109px)] md:h-[calc(100svh-130px)] bg-gray-50 flex flex-col overflow-hidden">

      {/* Mobile: thin bar to open the answers drawer, with a progress line beneath */}
      <div className="md:hidden flex-shrink-0 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm font-semibold text-gray-900">Chat with Proxy</span>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="text-xs text-red-600 font-medium underline"
          >
            {panelOpen ? "Hide answers" : "View your answers"}
          </button>
        </div>
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-red-600 transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {panelOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setPanelOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl h-[60vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <button
                onClick={() => {
                  startOver();
                  setPanelOpen(false);
                }}
                className="text-xs text-gray-400 hover:text-red-600 transition"
              >
                Start over
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <PreferencePanel
              preferences={preferences}
              weights={weights}
              sessionId={sessionId}
              onUpdated={handlePanelUpdate}
              onUpdating={setRecsUpdating}
            />
          </div>
        </div>
      )}

      {/* Main row — fills remaining height; min-h-0 prevents flex blowout.
          On mobile the chat goes edge-to-edge (no padding/card chrome) so it reads as
          one full-screen window under the bar; desktop keeps the framed card + side panel. */}
      <div className="flex-1 min-h-0 flex max-w-6xl w-full mx-auto px-0 py-0 gap-0 md:px-4 md:py-4 md:gap-4">

        {/* Chat column */}
        <div className="flex-1 min-h-0 flex flex-col bg-white border-0 rounded-none md:rounded-2xl md:border md:border-gray-200 overflow-hidden">
          {/* Slim header with a restart control. On mobile "Start over" lives inside
              the answers sheet instead, so this header is desktop-only. */}
          <div className="flex-shrink-0 hidden md:flex items-center gap-3 px-3 py-1.5 border-b border-gray-100">
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-red-600 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 tabular-nums w-7 text-right">{progressPct}%</span>
            </div>
            <button
              onClick={startOver}
              className="text-xs text-gray-400 hover:text-red-600 transition flex-shrink-0"
            >
              Start over
            </button>
          </div>
          {/* Recommendations now render inline in the chat so the user can keep
              chatting to refine — no full-screen swap. */}
          <ChatWindow
            messages={messages}
            loading={loading}
            recsUpdating={recsUpdating}
            userInitial={(preferences?.name ?? "").trim().charAt(0).toUpperCase()}
            onSend={handleUserSend}
            onAnswer={handleAnswer}
            onSendDraft={handleSendDraft}
            onEdit={handleEditFrom}
          />
        </div>

        {/* Side panel — desktop only; always the answers panel so users can edit */}
        <div className="hidden md:flex flex-col w-72 min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <PreferencePanel
            preferences={preferences}
            weights={weights}
            sessionId={sessionId}
            onUpdated={handlePanelUpdate}
            onUpdating={setRecsUpdating}
          />
        </div>
      </div>
    </div>
  );
}
