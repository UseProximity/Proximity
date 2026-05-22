import Anthropic from "@anthropic-ai/sdk";
import supabase from "@/lib/supabase";
import { rankListings } from "./listingFilter";

const SONNET_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 12;

const PROXY_SYSTEM_PROMPT = `You are Proxy, the matchmaking assistant for Proximity (an off-campus housing
platform for WashU students). Your job: collect the user's housing preferences
through a friendly conversation, then recommend three listings.

Voice: warm, concise, lightly playful. One question per turn. Never produce
walls of text. Acknowledge each answer in one short clause before moving on.

Process:
1. Greet the user, introduce yourself as Proxy.
2. Walk the QUESTION_PLAN in order. For each question, call update_preferences
   the moment the user answers. Recompute weights via update_weights when an
   answer maps to a weight (see WEIGHT_MAP).
3. If two collected preferences imply conflicting weights (e.g. tight budget
   but wants downtown amenities), call ask_tradeoff and pose the tradeoff to
   the user. Use their answer to set the relative weight (winner = 0.8,
   loser = 0.3).
4. When you have answered questions for: name, year, group_size, budget,
   area, lease_term, move_in window, and at least one priority — and you've
   resolved any tradeoffs — call finalize_recommendations with exactly three
   intentions. The first MUST be "Best overall match"; choose the other two
   from the user's top two weighted dimensions.
5. After finalize_recommendations runs, deliver a short closing message
   announcing the 3 picks — the UI shows the cards.

Hard rules:
- Never ask more than one question per message.
- Never invent preferences the user didn't state.
- Never recommend listings inline — only via finalize_recommendations.
- If the user goes off-script, gently steer back.`;

const TOOLS = [
  {
    name: "update_preferences",
    description: "Update one or more user preference fields based on their answer.",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "object",
          description: "Key-value pairs to merge into session.preferences",
          additionalProperties: true,
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "update_weights",
    description: "Update one or more weight values (0..1) based on the user's answers.",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "object",
          description: "Key-value pairs (weight name → 0..1) to merge into session.weights",
          additionalProperties: { type: "number" },
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "ask_tradeoff",
    description:
      "Surface a tradeoff question to the user. The UI renders this as choice chips.",
    input_schema: {
      type: "object",
      properties: {
        optionA: { type: "string" },
        optionB: { type: "string" },
        reasonShown: {
          type: "string",
          description: "One sentence explaining the tradeoff to the user",
        },
      },
      required: ["optionA", "optionB", "reasonShown"],
    },
  },
  {
    name: "finalize_recommendations",
    description:
      "Call when you have enough info to recommend. Pass exactly 3 intentions — first must be 'Best overall match'.",
    input_schema: {
      type: "object",
      properties: {
        intentions: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3,
          description:
            "Exactly 3 intention strings. First must be 'Best overall match'.",
        },
      },
      required: ["intentions"],
    },
  },
];

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function buildStateContext(session, turnCount) {
  return `Current session state (turn ${turnCount}/${MAX_TURNS}):
Preferences collected: ${JSON.stringify(session.preferences)}
Weights: ${JSON.stringify(session.weights)}`;
}

async function persistSession(session) {
  const { error } = await supabase
    .from("matchmaking_chat_sessions")
    .upsert(
      {
        id: session.id,
        user_id: session.user_id,
        status: session.status,
        transcript: session.transcript,
        preferences: session.preferences,
        weights: session.weights,
        candidates: session.candidates,
        recommendations: session.recommendations,
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`[chatOrchestrator] Failed to persist session: ${error.message}`);
}

export async function handleTurn({ session, userMessage }) {
  const isInit = !userMessage;

  if (!isInit) {
    session.transcript.push({
      role: "user",
      content: userMessage,
      ts: new Date().toISOString(),
    });
  }

  const turnCount = Math.ceil(session.transcript.length / 2) + 1;
  const forceFinalize = turnCount >= MAX_TURNS;

  const systemBlocks = [
    {
      type: "text",
      text: PROXY_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: buildStateContext(session, turnCount),
    },
  ];

  // Build messages array from transcript (last 40 entries = ~20 turns)
  const history = session.transcript.slice(-40);
  let apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

  // First turn: send a synthetic opener so Anthropic gets a user message
  if (apiMessages.length === 0) {
    apiMessages = [{ role: "user", content: "Hi" }];
  }

  const tools = forceFinalize
    ? [TOOLS.find((t) => t.name === "finalize_recommendations")]
    : TOOLS;
  const toolChoice = forceFinalize
    ? { type: "tool", name: "finalize_recommendations" }
    : { type: "auto" };

  let response = await getClient().messages.create({
    model: SONNET_MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    tools,
    tool_choice: toolChoice,
    messages: apiMessages,
  });

  let prefsChanged = false;
  let weightsChanged = false;
  let finalized = false;

  // Tool-use loop
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      let result;
      switch (toolUse.name) {
        case "update_preferences":
          session.preferences = { ...session.preferences, ...toolUse.input.patch };
          prefsChanged = true;
          result = { ok: true };
          break;
        case "update_weights":
          session.weights = { ...session.weights, ...toolUse.input.patch };
          weightsChanged = true;
          result = { ok: true };
          break;
        case "ask_tradeoff":
          result = { ok: true };
          break;
        case "finalize_recommendations": {
          try {
            const { ranked } = await rankListings({
              preferences: session.preferences,
              weights: session.weights,
              requestedIntentions: toolUse.input.intentions,
              limit: 3,
            });
            session.recommendations = ranked.slice(0, 3);
          } catch (err) {
            console.error("[chatOrchestrator] finalize rankListings failed:", err);
            session.recommendations = [];
          }
          session.status = "recommendations_ready";
          finalized = true;
          result = { ok: true, count: session.recommendations.length };
          break;
        }
        default:
          result = { error: "unknown tool" };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    apiMessages = [
      ...apiMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];

    response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools,
      messages: apiMessages,
    });
  }

  const assistantText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Background candidate refresh after any pref/weight change
  if ((prefsChanged || weightsChanged) && !finalized) {
    try {
      const { ranked } = await rankListings({
        preferences: session.preferences,
        weights: session.weights,
        requestedIntentions: [
          "Best overall match",
          "Best value",
          "Closest to campus",
        ],
        limit: 10,
      });
      session.candidates = ranked;
    } catch (err) {
      console.error("[chatOrchestrator] background rankListings failed:", err);
    }
  }

  session.transcript.push({
    role: "assistant",
    content: assistantText,
    ts: new Date().toISOString(),
  });

  await persistSession(session);

  return { assistantMessage: assistantText, session };
}
