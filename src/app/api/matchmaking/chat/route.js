import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { handleTurn, computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";
import { rankListings } from "@/lib/matchmaking/listingFilter";

async function resolveUserId(email) {
  const { data: user } = await supabase
    .from("users")
    .select("id, name")
    .eq("email", email.toLowerCase())
    .single();
  return user;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await resolveUserId(session.user.email);
    if (!user) return NextResponse.json({ session: null });

    const { data: chatSession } = await supabase
      .from("matchmaking_chat_sessions")
      .select("*")
      .eq("user_id", user.id)
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
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await resolveUserId(session.user.email);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = await request.json();
    const { sessionId, message, answer, preferences, weights, action, transcript } = body;

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
      if (data.user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      chatSession = data;
    } else {
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .insert({
          user_id: user.id,
          preferences: { name: user.name ?? "" },
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

    const { assistantMessage, nextQuestion, session: updatedSession } = await handleTurn({
      session: chatSession,
      answer: answer ?? null,
      message: message ?? "",
      preferences: preferences ?? null,
      weights: weights ?? null,
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
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await resolveUserId(session.user.email);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
    if (chatSession.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatedPreferences = { ...chatSession.preferences, ...patch };
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
    if (chatSession.status === "recommendations_ready") {
      try {
        recommendations = await computeRecommendations(updatedPreferences, updatedWeights);
      } catch (err) {
        console.error("[matchmaking/chat PATCH] computeRecommendations failed:", err);
      }
    }

    const { error: updateError } = await supabase
      .from("matchmaking_chat_sessions")
      .update({ preferences: updatedPreferences, weights: updatedWeights, candidates, recommendations })
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
