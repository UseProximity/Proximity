// Matchmaking chat state, mirroring apps/web/src/components/matchmaking/ChatClient.js's
// logic (same optimistic-update flow via the shared questionEngine, same
// request shapes against apiClient.matchmaking.*) but as a Zustand store
// instead of component state, and in-memory only: the server is the source of truth
// for a signed-in user's chat (GET /api/matchmaking/chat resumes it), so nothing is
// persisted across an app restart.
//
// Signed out: the website lets a visitor chat anonymously, so the API answers a request
// with no session with 200 { session: null, anonymous: true } rather than a 401. The app
// has no anonymous flow; init() treats that answer (and a 401, e.g. an expired token) as
// "sign in first" by setting needsAuth, without starting a chat.
import { create } from "zustand";
import apiClient from "../lib/apiClient";
import { useAuthStore } from "./authStore";
import { createTurnQueue } from "../lib/turnQueue";
import { isNetworkError } from "../lib/apiError";
import { ERROR_MESSAGES } from "../lib/errorMessages";
import {
  applyAnswer,
  nextQuestion,
  answerToLabel,
  describeQuestion,
  rewindTo,
  QUESTION_BY_ID,
} from "@proximity/shared";

// Bumped by reset() whenever the auth identity changes. init() and startFresh() remember
// the value they started under and drop their result if it has moved on, so a slow
// request from the previous identity cannot overwrite the newer state.
let epoch = 0;

// Serializes every POST so a fast double-tap can never let the server see
// out-of-order writes (mirrors ChatClient's postChain ref). See lib/turnQueue.js for how
// a task from a previous identity is skipped or told it is stale.
const enqueue = createTurnQueue({
  getEpoch: () => epoch,
  isSignedIn: () => Boolean(useAuthStore.getState().user?.id),
  onSignedOut: () => useChatStore.setState({ needsAuth: true, loading: false }),
});

function questionToMessage(q, animate = false) {
  return { role: "assistant", content: q.prompt, ts: new Date().toISOString(), question: q, animate };
}

// Identity of a question: its id plus the step key that keeps repeated ids (the
// numbered tradeoffs) distinct. Also keys the answer controls, so each question
// starts with fresh local state.
export const qKey = (q) => (q ? `${q.id}:${q.meta?.stepKey ?? ""}` : "");

// Proxy's standalone remark (data.note) shown just before the next question, as its own
// bubble so it never gets mixed into the question text.
function noteMessage(note) {
  return { role: "assistant", content: note, ts: new Date().toISOString(), animate: true };
}

// Appends the question a response asks next, with its note ahead of it. Does nothing when
// that question is already the latest message (the optimistic local copy).
function withNextQuestion(messages, data) {
  if (qKey(messages[messages.length - 1]?.question) === qKey(data.nextQuestion)) return messages;
  return [
    ...messages,
    ...(data.note ? [noteMessage(data.note)] : []),
    questionToMessage(data.nextQuestion, true),
  ];
}

// A mid-script answer shows its next question from the local script straight away, so a
// note on the server's reply (e.g. the big-group heads-up) is slotted in before that
// question when it arrives.
function withNoteBeforeQuestion(messages, data) {
  if (!data.note || !data.nextQuestion) return messages;
  if (messages.some((m) => m.role === "assistant" && m.content === data.note)) return messages;
  const at = messages.map((m) => qKey(m.question)).lastIndexOf(qKey(data.nextQuestion));
  if (at < 0) return messages;
  return [...messages.slice(0, at), noteMessage(data.note), ...messages.slice(at)];
}

// Says so when a turn fails, instead of leaving the student waiting for a reply that is
// not coming. `retryQuestion` is the question the failed turn consumed: it is asked again
// after the message so the answer controls come back. Without one, a question that is
// already the latest message stays last, so it keeps its controls.
function reportTurnFailure(retryQuestion) {
  const failure = {
    role: "assistant",
    content: ERROR_MESSAGES.MATCHMAKING.TURN,
    ts: new Date().toISOString(),
    animate: true,
  };
  useChatStore.setState((state) => {
    const last = state.messages[state.messages.length - 1];
    if (retryQuestion) return { messages: [...state.messages, failure, questionToMessage(retryQuestion, false)] };
    if (last?.question) return { messages: [...state.messages.slice(0, -1), failure, last] };
    return { messages: [...state.messages, failure] };
  });
}

// A saved question the current script can still ask as it was saved. Server-written
// tradeoff questions (the narrowing and commute turns) are not in the script.
const isCurrentQuestion = (q) => q.kind === "tradeoff" || QUESTION_BY_ID[q.id]?.kind === q.kind;

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
    const startedIn = epoch;
    try {
      const { session, anonymous } = await apiClient.matchmaking.getSession();
      if (startedIn !== epoch) return;
      // A request with no session is answered as an anonymous website visitor, not a
      // 401 (see GET /api/matchmaking/chat). The app has no anonymous flow, so this is
      // the same "sign in first" outcome, reached before any chat is started.
      if (anonymous) {
        set({ needsAuth: true, loading: false });
        return;
      }
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
        // descriptor (no chips), so it can't be answered. Restart it cleanly.
        const isStaleOldChat =
          session.status !== "recommendations_ready" &&
          serverMessages.length > 0 &&
          !serverMessages.some((m) => m.question);
        // A session saved under an older script can be waiting on a question that no longer
        // exists (name_confirm, program, grad_year) or changed shape (lease_term was
        // multi-select), which the app cannot render or the server cannot take. Restart too.
        const pendingQuestion = serverMessages[serverMessages.length - 1]?.question;
        const isStaleScript =
          session.status !== "recommendations_ready" && pendingQuestion && !isCurrentQuestion(pendingQuestion);
        if (isStaleOldChat || isStaleScript) {
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
      if (startedIn !== epoch) return;
      if (err?.status === 401) {
        set({ needsAuth: true, loading: false });
        return;
      }
      console.error("[chatStore] init failed:", err);
      set({
        error: isNetworkError(err) ? ERROR_MESSAGES.MATCHMAKING.OFFLINE : ERROR_MESSAGES.MATCHMAKING.LOAD,
        loading: false,
      });
    }
  },

  startFresh: async () => {
    // Every way into a new chat passes here (init, and startOver from the error-state
    // refresh), so this is where a signed-out user is stopped: the app has no anonymous
    // flow, and the server would otherwise mint a visitor session for the request.
    if (!useAuthStore.getState().user?.id) {
      set({ needsAuth: true, loading: false });
      return;
    }
    set({ loading: true, error: null });
    const startedIn = epoch;
    try {
      const data = await apiClient.matchmaking.sendTurn({ message: "" });
      if (startedIn !== epoch) return;
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
      if (startedIn !== epoch) return;
      if (err?.status === 401) {
        set({ needsAuth: true, loading: false });
        return;
      }
      console.error("[chatStore] startFresh failed:", err);
      set({
        error: isNetworkError(err) ? ERROR_MESSAGES.MATCHMAKING.OFFLINE : ERROR_MESSAGES.MATCHMAKING.START,
        loading: false,
      });
    }
  },

  startOver: async () => {
    set({ ...initialState, isInitialized: true });
    await get().startFresh();
  },

  // Leaves isInitialized false so a subsequent init() actually runs its auth
  // check instead of no-op'ing on stale state from a previous session.
  reset: () => {
    epoch += 1;
    set({ ...initialState });
  },

  // Called whenever the resolved auth identity changes (login or logout);
  // see the effect in app/(tabs)/matchmaking.js that watches authStore's
  // user?.id. A mount-only init() can't catch this: once a tab has been
  // visited it stays mounted for the app's lifetime (no unmountOnBlur), so
  // nothing would otherwise re-run the auth check after a logout/login that
  // happens while already mounted. init() itself decides the outcome;
  // this just guarantees the check actually re-runs on every identity change.
  reinit: async () => {
    get().reset();
    await get().init();
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
        loading: !upcoming, // finalizing (last scripted answer); ranking is the only wait
      };
    });

    const finalizing = !upcoming;
    // The question this answer consumed; asked again if the final turn fails.
    const retryQuestion = finalizing ? get().messages.findLast((m) => m.question)?.question : null;
    const snapshot = { preferences: applied.preferences, weights: applied.weights };
    enqueue(async (isStale) => {
      try {
        const data = await apiClient.matchmaking.sendTurn({ sessionId, answer, ...snapshot });
        if (isStale()) return;
        if (finalizing) {
          set({
            preferences: data.preferences ?? get().preferences,
            weights: data.weights ?? get().weights,
            recommendations: data.recommendations ?? get().recommendations,
            status: data.status ?? get().status,
          });
          if (data.nextQuestion) {
            set((state) => ({ messages: withNextQuestion(state.messages, data) }));
          } else if (data.recommendations?.length) {
            get()._appendRecsWithContact(data);
          }
        } else {
          if (data.recommendations || data.status) {
            set({
              recommendations: data.recommendations ?? get().recommendations,
              status: data.status ?? get().status,
            });
          }
          if (data.note) set((state) => ({ messages: withNoteBeforeQuestion(state.messages, data) }));
        }
      } catch (err) {
        if (isStale()) return;
        if (err?.status === 401) {
          set({ needsAuth: true, loading: false });
          return;
        }
        console.error("[chatStore] answerQuestion failed:", err);
        reportTurnFailure(retryQuestion);
      } finally {
        if (finalizing && !isStale()) set({ loading: false });
      }
    });
  },

  _answerTradeoff: (answer) => {
    const { sessionId, preferences, weights } = get();
    // The tradeoff question this answer consumed; asked again if the turn fails.
    const retryQuestion = get().messages.findLast((m) => m.question)?.question;
    set((state) => ({
      messages: [...state.messages, { role: "user", content: answerToLabel(answer), ts: new Date().toISOString() }],
      loading: true,
    }));
    enqueue(async (isStale) => {
      try {
        const data = await apiClient.matchmaking.sendTurn({
          sessionId,
          tradeoff: { chosen: answer.value },
          preferences,
          weights,
        });
        if (isStale()) return;
        set({
          recommendations: data.recommendations ?? get().recommendations,
          status: data.status ?? get().status,
          preferences: data.preferences ?? get().preferences,
          weights: data.weights ?? get().weights,
        });
        if (data.nextQuestion) {
          set((state) => ({ messages: withNextQuestion(state.messages, data) }));
        } else if (data.recommendations?.length) {
          get()._appendRecsWithContact(data);
        }
      } catch (err) {
        if (isStale()) return;
        if (err?.status === 401) {
          set({ needsAuth: true, loading: false });
          return;
        }
        console.error("[chatStore] tradeoff failed:", err);
        reportTurnFailure(retryQuestion);
      } finally {
        if (!isStale()) set({ loading: false });
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
    enqueue(async (isStale) => {
      try {
        const data = await apiClient.matchmaking.contactOwners({ sessionId, listingIds, message, selectionLabel });
        if (isStale()) return;
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
        if (isStale()) return;
        if (err?.status === 401) {
          set({ needsAuth: true, loading: false });
          return;
        }
        console.error("[chatStore] sendDraft failed:", err);
        set((state) => ({
          messages: [
            ...state.messages,
            { role: "assistant", content: ERROR_MESSAGES.MATCHMAKING.CONTACT, ts: new Date().toISOString(), animate: true },
          ],
        }));
      } finally {
        if (!isStale()) set({ loading: false });
      }
    });
  },

  // Free-text send: parses an answer mid-flow, or refines the picks once
  // recommendations are ready (server replies with mode: "agent").
  sendMessage: (text) => {
    const { sessionId, preferences, weights } = get();
    set((state) => ({
      messages: [...state.messages, { role: "user", content: text, ts: new Date().toISOString() }],
      loading: true,
    }));
    enqueue(async (isStale) => {
      try {
        const data = await apiClient.matchmaking.sendTurn({ sessionId, message: text, preferences, weights });
        if (isStale()) return;
        set({
          recommendations: data.recommendations ?? get().recommendations,
          status: data.status ?? get().status,
          preferences: data.preferences ?? get().preferences,
          weights: data.weights ?? get().weights,
        });
        if (data.mode === "agent") {
          if (data.pendingRelax) {
            // The re-rank found nothing new: this reply only announces that the search is
            // being widened. Run the widening turn now (the typing row stays up meanwhile).
            set((state) => ({
              messages: [
                ...state.messages,
                { role: "assistant", content: data.assistantMessage, ts: new Date().toISOString(), animate: true },
              ],
            }));
            const widened = await apiClient.matchmaking.relaxRetry({ sessionId });
            if (isStale()) return;
            set({
              recommendations: widened.recommendations ?? get().recommendations,
              status: widened.status ?? get().status,
              preferences: widened.preferences ?? get().preferences,
              weights: widened.weights ?? get().weights,
            });
            if (widened.reranked && widened.recommendations?.length) {
              get()._appendRecsWithContact(widened);
            } else if (widened.assistantMessage) {
              set((state) => ({
                messages: [
                  ...state.messages,
                  { role: "assistant", content: widened.assistantMessage, ts: new Date().toISOString(), animate: true },
                ],
              }));
            }
          } else if (data.reranked && data.recommendations?.length) {
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
          set((state) => ({ messages: withNextQuestion(state.messages, data) }));
        } else if (data.recommendations?.length) {
          get()._appendRecsWithContact(data);
        }
      } catch (err) {
        if (isStale()) return;
        if (err?.status === 401) {
          set({ needsAuth: true, loading: false });
          return;
        }
        console.error("[chatStore] sendMessage failed:", err);
        reportTurnFailure(null);
      } finally {
        if (!isStale()) set({ loading: false });
      }
    });
  },

  // Edit a past answer: rewind prefs/weights to before that question, truncate
  // the transcript back to it, and re-ask it. The user continues forward from there.
  editAnswer: (questionId) => {
    // Answers from an older script or the narrowing turns ("tradeoff") have no question
    // in the script to re-ask.
    if (!QUESTION_BY_ID[questionId]) return;
    const { preferences, sessionId } = get();
    const rewound = rewindTo(preferences, questionId);

    set((state) => {
      const idx = state.messages.findIndex((m) => m.question?.id === questionId);
      const head = idx >= 0 ? state.messages.slice(0, idx) : state.messages;
      const descriptor = describeQuestion(QUESTION_BY_ID[questionId], rewound.preferences);
      const truncated = [...head, questionToMessage(descriptor, false)];

      enqueue((isStale) =>
        apiClient.matchmaking
          .rewind({ sessionId, transcript: truncated, preferences: rewound.preferences, weights: rewound.weights })
          .catch((err) => {
            if (isStale()) return;
            if (err?.status === 401) {
              set({ needsAuth: true });
              return;
            }
            console.error("[chatStore] rewind failed:", err);
          })
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

// A different signed-in identity (sign out, sign in, or a direct switch) ends everything
// still queued or in flight for the previous one, and clears its chat, at once and whether
// or not the matchmaking screen has re-run its effect yet (it holds back while the new user
// has not agreed to AI consent, and must not be left showing the old one's state or a
// stuck spinner). Token refreshes and profile edits keep the same id, so they change
// nothing. The screen's reinit() still restarts the chat once it is allowed to.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) useChatStore.getState().reset();
});
