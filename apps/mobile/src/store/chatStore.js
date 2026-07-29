// Matchmaking chat state, mirroring apps/web/src/components/matchmaking/ChatClient.js's
// logic (same optimistic-update flow via the shared questionEngine, same
// request shapes against apiClient.matchmaking.*) but as a Zustand store
// instead of component state, and in-memory only — a guest's session can't be
// resumed server-side anyway (GET /api/matchmaking/chat always returns
// { session: null } for the shared guest identity), so there's nothing to gain
// from persisting across an app restart, matching this plan's "in-memory"
// framing of the port.
import { create } from "zustand";
import apiClient from "../lib/apiClient";
import {
  applyAnswer,
  nextQuestion,
  answerToLabel,
  describeQuestion,
  rewindTo,
  QUESTION_BY_ID,
} from "@proximity/shared";

// Serializes every POST so a fast double-tap can never let the server see
// out-of-order writes (mirrors ChatClient's postChain ref).
let postChain = Promise.resolve();
function enqueue(task) {
  postChain = postChain.then(task, task);
  return postChain;
}

function questionToMessage(q, animate = false) {
  return { role: "assistant", content: q.prompt, ts: new Date().toISOString(), question: q, animate };
}

const qKey = (q) => (q ? `${q.id}:${q.meta?.stepKey ?? ""}` : "");

function inlineRecsMessage(data) {
  return {
    role: "assistant",
    content: data.assistantMessage || "Here are your top matches:",
    ts: new Date().toISOString(),
    recommendations: data.recommendations,
    animate: true,
  };
}

// Builds the "want me to reach out to any of these owners?" question that
// follows the matches. Returns { message, contactMap } or null if no recs.
function buildContactMessage(recommendations, animate = true) {
  const recs = (recommendations ?? []).filter((r) => r?.listing_id);
  if (!recs.length) return null;
  const seen = new Map();
  const options = recs.map((r) => {
    const base = (r.card_data?.title || r.card_data?.address || r.intention || "Listing").trim();
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
  const contactMap = Object.fromEntries(recs.map((r, i) => [options[i], r.listing_id]));
  const message = questionToMessage(
    {
      id: "contact_owners",
      kind: "contact",
      prompt: "Want me to reach out to any of these owners for you? I'll email them and CC you. Pick all that apply.",
      options,
      meta: { contact: true },
    },
    animate
  );
  return { message, contactMap };
}

const initialState = {
  sessionId: null,
  messages: [],
  preferences: {},
  weights: {},
  recommendations: [],
  status: "in_progress",
  loading: false,
  needsAuth: false,
  error: null,
  isInitialized: false,
  contactMap: {},
};

export const useChatStore = create((set, get) => ({
  ...initialState,

  init: async () => {
    if (get().isInitialized) return;
    set({ loading: true, isInitialized: true });
    try {
      const { session } = await apiClient.matchmaking.getSession();
      if (session) {
        const serverMessages = (session.transcript ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          ts: m.ts,
          ...(m.question ? { question: m.question } : {}),
          ...(m.questionId ? { questionId: m.questionId } : {}),
          ...(m.recommendations ? { recommendations: m.recommendations } : {}),
        }));
        // A pre-rework session has messages but none carry a `question`
        // descriptor (no chips) — it can't be answered. Restart it cleanly.
        const isStaleOldChat =
          session.status !== "recommendations_ready" &&
          serverMessages.length > 0 &&
          !serverMessages.some((m) => m.question);
        if (isStaleOldChat) {
          await get().startFresh();
          return;
        }

        let messages = serverMessages;
        let contactMap = {};
        if (serverMessages.length > 0) {
          const last = serverMessages[serverMessages.length - 1];
          if (session.status === "recommendations_ready" && last?.recommendations) {
            const contact = buildContactMessage(session.recommendations, false);
            if (contact) {
              messages = [...serverMessages, contact.message];
              contactMap = contact.contactMap;
            }
          }
        }

        set({
          sessionId: session.id,
          preferences: session.preferences ?? {},
          weights: session.weights ?? {},
          recommendations: session.recommendations ?? [],
          status: session.status,
          messages,
          contactMap,
          loading: false,
        });
        if (messages.length === 0) await get().startFresh();
      } else {
        await get().startFresh();
      }
    } catch (err) {
      if (err?.status === 401) {
        set({ needsAuth: true, loading: false });
        return;
      }
      console.error("[chatStore] init failed:", err);
      set({ error: "Couldn't reach Proxy. Pull to try again.", loading: false });
    }
  },

  startFresh: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.matchmaking.sendTurn({ message: "" });
      set({
        sessionId: data.sessionId,
        preferences: data.preferences ?? {},
        weights: data.weights ?? {},
        recommendations: data.recommendations ?? [],
        status: data.status ?? "in_progress",
        messages: [
          data.nextQuestion
            ? questionToMessage(data.nextQuestion, true)
            : { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString() },
        ],
        loading: false,
      });
    } catch (err) {
      if (err?.status === 401) {
        set({ needsAuth: true, loading: false });
        return;
      }
      console.error("[chatStore] startFresh failed:", err);
      set({ error: "Couldn't start a chat with Proxy. Pull to try again.", loading: false });
    }
  },

  startOver: async () => {
    set({ ...initialState, isInitialized: true });
    await get().startFresh();
  },

  // Chip/structured answer. Tradeoff and contact-offer answers are server-driven
  // (need live listing data / send email), so they skip the optimistic path.
  answerQuestion: (answer) => {
    if (answer.kind === "tradeoff") return get()._answerTradeoff(answer);
    if (answer.kind === "contact") return get()._answerContact(answer);

    const { preferences, weights, sessionId } = get();
    const applied = applyAnswer(preferences, weights, answer);
    const upcoming = nextQuestion(applied.preferences);

    set((state) => {
      const msgs = [
        ...state.messages,
        { role: "user", content: answerToLabel(answer), ts: new Date().toISOString(), questionId: answer.questionId },
      ];
      if (upcoming && qKey(state.messages[state.messages.length - 1]?.question) !== qKey(upcoming)) {
        msgs.push(questionToMessage(upcoming, true));
      }
      return {
        preferences: applied.preferences,
        weights: applied.weights,
        messages: msgs,
        loading: !upcoming, // finalizing (last scripted answer) — ranking is the only wait
      };
    });

    const finalizing = !upcoming;
    const snapshot = { preferences: applied.preferences, weights: applied.weights };
    enqueue(async () => {
      try {
        const data = await apiClient.matchmaking.sendTurn({ sessionId, answer, ...snapshot });
        if (finalizing) {
          set({
            preferences: data.preferences ?? get().preferences,
            weights: data.weights ?? get().weights,
            recommendations: data.recommendations ?? get().recommendations,
            status: data.status ?? get().status,
          });
          if (data.nextQuestion) {
            set((state) =>
              qKey(state.messages[state.messages.length - 1]?.question) === qKey(data.nextQuestion)
                ? {}
                : { messages: [...state.messages, questionToMessage(data.nextQuestion, true)] }
            );
          } else if (data.recommendations?.length) {
            get()._appendRecsWithContact(data);
          }
        } else if (data.recommendations || data.status) {
          set({
            recommendations: data.recommendations ?? get().recommendations,
            status: data.status ?? get().status,
          });
        }
      } catch (err) {
        console.error("[chatStore] answerQuestion failed:", err);
      } finally {
        if (finalizing) set({ loading: false });
      }
    });
  },

  _answerTradeoff: (answer) => {
    const { sessionId, preferences, weights } = get();
    set((state) => ({
      messages: [...state.messages, { role: "user", content: answerToLabel(answer), ts: new Date().toISOString() }],
      loading: true,
    }));
    enqueue(async () => {
      try {
        const data = await apiClient.matchmaking.sendTurn({
          sessionId,
          tradeoff: { chosen: answer.value },
          preferences,
          weights,
        });
        set({
          recommendations: data.recommendations ?? get().recommendations,
          status: data.status ?? get().status,
          preferences: data.preferences ?? get().preferences,
          weights: data.weights ?? get().weights,
        });
        if (data.nextQuestion) {
          set((state) =>
            qKey(state.messages[state.messages.length - 1]?.question) === qKey(data.nextQuestion)
              ? {}
              : { messages: [...state.messages, questionToMessage(data.nextQuestion, true)] }
          );
        } else if (data.recommendations?.length) {
          get()._appendRecsWithContact(data);
        }
      } catch (err) {
        console.error("[chatStore] tradeoff failed:", err);
      } finally {
        set({ loading: false });
      }
    });
  },

  _appendRecsWithContact: (data) => {
    set((state) => {
      const next = [...state.messages, inlineRecsMessage(data)];
      const contact = buildContactMessage(data.recommendations);
      if (contact) {
        next.push(contact.message);
        return { messages: next, contactMap: contact.contactMap };
      }
      return { messages: next };
    });
  },

  // The student answered the post-recs "want me to contact owners?" offer.
  // Shows an editable draft; nothing sends until sendDraft() is called.
  _answerContact: (answer) => {
    const labels = Array.isArray(answer.value) ? answer.value : [];
    const { contactMap, preferences } = get();
    const listingIds = labels.map((l) => contactMap[l]).filter(Boolean);
    const selectionLabel = labels.length ? `Reach out to: ${labels.join(", ")}` : "No thanks";

    set((state) => ({
      messages: [...state.messages, { role: "user", content: selectionLabel, ts: new Date().toISOString() }],
    }));

    if (!listingIds.length) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: "assistant",
            content:
              "No problem, I can always reach out later. In the meantime, want me to fine-tune your matches, compare these places, or dig into the details on any of them? Just say the word.",
            ts: new Date().toISOString(),
            animate: true,
          },
        ],
      }));
      return;
    }

    const recipientsLabel = labels.join(" & ");
    const name = (preferences?.name || "").trim();
    const greeting = name ? `Hi, I'm ${name}` : "Hi";
    const defaultNote = `${greeting}, I found your listing through Proximity and I'm interested in learning more. Could you share more details about availability and next steps? Thanks!`;

    set((state) => ({
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: `Here's the note I'll send to the owner${listingIds.length > 1 ? "s" : ""} of ${recipientsLabel}. Edit anything you'd like, then hit send and I'll reach out (and CC you).`,
          ts: new Date().toISOString(),
          animate: true,
          draft: { draftId: String(Date.now()), listingIds, recipientsLabel, selectionLabel, message: defaultNote },
        },
      ],
    }));
  },

  sendDraft: (draft, message) => {
    const { sessionId } = get();
    const { draftId, listingIds, selectionLabel } = draft;
    set((state) => ({
      messages: state.messages.map((m) =>
        m.draft?.draftId === draftId ? { ...m, draft: { ...m.draft, message, sent: true } } : m
      ),
      loading: true,
    }));
    enqueue(async () => {
      try {
        const data = await apiClient.matchmaking.contactOwners({ sessionId, listingIds, message, selectionLabel });
        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: "assistant",
              content: data.assistantMessage || "Done! I've reached out on your behalf.",
              ts: new Date().toISOString(),
              animate: true,
            },
          ],
        }));
      } catch (err) {
        console.error("[chatStore] sendDraft failed:", err);
        set((state) => ({
          messages: [
            ...state.messages,
            { role: "assistant", content: "I couldn't reach out just now, please try again in a bit.", ts: new Date().toISOString(), animate: true },
          ],
        }));
      } finally {
        set({ loading: false });
      }
    });
  },

  // Free-text send — parses an answer mid-flow, or refines the picks once
  // recommendations are ready (server replies with mode: "agent").
  sendMessage: (text) => {
    const { sessionId, preferences, weights } = get();
    set((state) => ({
      messages: [...state.messages, { role: "user", content: text, ts: new Date().toISOString() }],
      loading: true,
    }));
    enqueue(async () => {
      try {
        const data = await apiClient.matchmaking.sendTurn({ sessionId, message: text, preferences, weights });
        set({
          recommendations: data.recommendations ?? get().recommendations,
          status: data.status ?? get().status,
          preferences: data.preferences ?? get().preferences,
          weights: data.weights ?? get().weights,
        });
        if (data.mode === "agent") {
          if (data.reranked && data.recommendations?.length) {
            get()._appendRecsWithContact(data);
          } else if (data.draft?.listingIds?.length) {
            set((state) => ({
              messages: [
                ...state.messages,
                {
                  role: "assistant",
                  content: data.assistantMessage || "Here's a draft, edit and send when ready:",
                  ts: new Date().toISOString(),
                  animate: true,
                  draft: { draftId: String(Date.now()), ...data.draft },
                },
              ],
            }));
          } else if (data.assistantMessage) {
            set((state) => ({
              messages: [...state.messages, { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString(), animate: true }],
            }));
          }
        } else if (data.nextQuestion) {
          set((state) =>
            qKey(state.messages[state.messages.length - 1]?.question) === qKey(data.nextQuestion)
              ? {}
              : { messages: [...state.messages, questionToMessage(data.nextQuestion, true)] }
          );
        } else if (data.recommendations?.length) {
          get()._appendRecsWithContact(data);
        }
      } catch (err) {
        console.error("[chatStore] sendMessage failed:", err);
      } finally {
        set({ loading: false });
      }
    });
  },

  // Edit a past answer: rewind prefs/weights to before that question, truncate
  // the transcript back to it, and re-ask it. The user continues forward from there.
  editAnswer: (questionId) => {
    const { preferences, sessionId } = get();
    const rewound = rewindTo(preferences, questionId);

    set((state) => {
      const idx = state.messages.findIndex((m) => m.question?.id === questionId);
      const head = idx >= 0 ? state.messages.slice(0, idx) : state.messages;
      const descriptor = describeQuestion(QUESTION_BY_ID[questionId], rewound.preferences);
      const truncated = [...head, questionToMessage(descriptor, false)];

      enqueue(() =>
        apiClient.matchmaking
          .rewind({ sessionId, transcript: truncated, preferences: rewound.preferences, weights: rewound.weights })
          .catch((err) => console.error("[chatStore] rewind failed:", err))
      );

      return {
        preferences: rewound.preferences,
        weights: rewound.weights,
        status: "in_progress",
        recommendations: [],
        messages: truncated,
      };
    });
  },
}));
