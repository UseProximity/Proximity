import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";
import { handleTurn, computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";
import { rankListings } from "@/lib/matchmaking/listingFilter";

// Shared identity for anonymous, no-login testing. Used ONLY outside production
// (staging / Vercel previews / local) so anyone can try the matchmaker from a
// test URL without an account. Must exist in the dev database.
const GUEST_EMAIL = "guest@proximity.test";

async function resolveUserId(email) {
  const { data: user } = await supabase
    .from("users")
    .select("id, name, gender")
    .eq("email", email.toLowerCase())
    .single();
  return user;
}

// Resolve who is acting on this request. A signed-in user is always honored.
// With no session, production requires login (401); non-production falls back
// to the shared guest tester so the chatbot is usable without an account.
async function resolveActor(session) {
  if (session?.user?.email) {
    const user = await resolveUserId(session.user.email);
    if (!user) return { error: { msg: "User not found", status: 404 } };
    return { actor: user, isGuest: false };
  }
  if (!isProdData()) {
    const guest = await resolveUserId(GUEST_EMAIL);
    if (!guest) return { error: { msg: "Guest tester not provisioned", status: 503 } };
    return { actor: guest, isGuest: true };
  }
  return { error: { msg: "Unauthorized", status: 401 } };
}

export async function GET() {
  try {
    const { actor, isGuest, error } = await resolveActor(await auth());
    if (error) return NextResponse.json({ error: error.msg }, { status: error.status });

    // Guests share one identity, so don't resume "the latest session" — that
    // could surface another tester's chat. Each guest resumes via localStorage.
    if (isGuest) return NextResponse.json({ session: null });

    const { data: chatSession } = await supabase
      .from("matchmaking_chat_sessions")
      .select("*")
      .eq("user_id", actor.id)
      .not("status", "eq", "abandoned")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ session: chatSession ?? null });
  } catch (err) {
    console.error("[matchmaking/chat GET]", err);
    return NextResponse.json({ session: null });
  }
}

export async function POST(request) {
  try {
    const { actor, error: actorError } = await resolveActor(await auth());
    if (actorError) return NextResponse.json({ error: actorError.msg }, { status: actorError.status });

    const body = await request.json();
    const { sessionId, message, answer, preferences, weights, action, transcript, tradeoff } = body;

    let chatSession;

    if (sessionId) {
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (data.user_id !== actor.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      chatSession = data;
    } else {
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .insert({
          user_id: actor.id,
          // Greet on a first-name basis: take the first token of the stored name.
          preferences: { name: (actor.name ?? "").trim().split(/\s+/)[0] ?? "" },
          weights: {},
          transcript: [],
          candidates: [],
          recommendations: [],
          status: "in_progress",
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
      }
      chatSession = data;
    }

    // Rewind: the user clicked "edit" on a past prompt. Replace the session's
    // prefs/weights/transcript with the client's truncated, authoritative copy.
    if (action === "rewind") {
      const { error: rewindErr } = await supabase
        .from("matchmaking_chat_sessions")
        .update({
          preferences: preferences ?? chatSession.preferences,
          weights: weights ?? chatSession.weights,
          transcript: transcript ?? chatSession.transcript,
          recommendations: [],
          status: "in_progress",
        })
        .eq("id", chatSession.id);
      if (rewindErr) {
        return NextResponse.json({ error: "Failed to rewind session" }, { status: 500 });
      }
      return NextResponse.json({ sessionId: chatSession.id, status: "in_progress", nextQuestion: null });
    }

    // Stamp the student's account gender onto the session prefs (server-only,
    // hidden key) so the ranker can hard-exclude listings whose descriptions
    // restrict occupants to a gender they aren't. See listingConstraints.
    chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor.gender ?? null };

    const { assistantMessage, nextQuestion, session: updatedSession } = await handleTurn({
      session: chatSession,
      answer: answer ?? null,
      message: message ?? "",
      preferences: preferences ?? null,
      weights: weights ?? null,
      tradeoff: tradeoff ?? null,
    });

    return NextResponse.json({
      sessionId: updatedSession.id,
      assistantMessage,
      nextQuestion,
      preferences: updatedSession.preferences,
      weights: updatedSession.weights,
      candidates: updatedSession.candidates,
      recommendations: updatedSession.recommendations,
      status: updatedSession.status,
    });
  } catch (err) {
    console.error("[matchmaking/chat POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { actor, error: actorError } = await resolveActor(await auth());
    if (actorError) return NextResponse.json({ error: actorError.msg }, { status: actorError.status });

    const body = await request.json();
    const { sessionId, patch, weights } = body;
    if (!sessionId || !patch) {
      return NextResponse.json({ error: "sessionId and patch are required" }, { status: 400 });
    }

    const { data: chatSession, error } = await supabase
      .from("matchmaking_chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (error || !chatSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (chatSession.user_id !== actor.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatedPreferences = { ...chatSession.preferences, ...patch, _viewerGender: actor.gender ?? null };
    // The panel may send freshly recomputed weights (e.g. reordered priorities).
    const updatedWeights = weights ?? chatSession.weights;

    let candidates = chatSession.candidates;
    try {
      const { ranked } = await rankListings({
        preferences: updatedPreferences,
        weights: updatedWeights,
        requestedIntentions: ["Best overall match", "Best value", "Closest to campus"],
        limit: 10,
      });
      candidates = ranked;
    } catch (err) {
      console.error("[matchmaking/chat PATCH] rankListings failed:", err);
    }

    // If the user already has their 3 picks, reordering priorities should refresh
    // them right away rather than waiting for a chat refine.
    let recommendations = chatSession.recommendations;
    let transcript = chatSession.transcript;
    if (chatSession.status === "recommendations_ready") {
      try {
        recommendations = await computeRecommendations(updatedPreferences, updatedWeights);
        // The chat is rebuilt from the transcript on reload, and each "here are
        // your matches" message embeds its own copy of the picks. Rewrite the
        // latest such message so a refresh shows the NEW matches, not the old set.
        if (Array.isArray(transcript)) {
          for (let i = transcript.length - 1; i >= 0; i--) {
            if (Array.isArray(transcript[i].recommendations) && transcript[i].recommendations.length) {
              transcript = transcript.map((m, idx) => (idx === i ? { ...m, recommendations } : m));
              break;
            }
          }
        }
      } catch (err) {
        console.error("[matchmaking/chat PATCH] computeRecommendations failed:", err);
      }
    }

    const { error: updateError } = await supabase
      .from("matchmaking_chat_sessions")
      .update({ preferences: updatedPreferences, weights: updatedWeights, candidates, recommendations, transcript })
      .eq("id", sessionId);
    if (updateError) {
      return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
    }

    return NextResponse.json({
      sessionId,
      preferences: updatedPreferences,
      weights: updatedWeights,
      candidates,
      recommendations,
      status: chatSession.status,
    });
  } catch (err) {
    console.error("[matchmaking/chat PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
