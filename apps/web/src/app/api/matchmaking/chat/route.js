import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";
import { handleTurn, computeRecommendations, continueRelaxedSearch, rewindToTradeoff } from "@/lib/matchmaking/chatOrchestrator";
import { sendOwnerInquiryEmail } from "@/lib/email";
import { recordListingContact } from "@/lib/contactTracking";

// Shared identity for anonymous, no-login testing. Used ONLY outside production
// (staging / Vercel previews / local) so anyone can try the matchmaker from a
// test URL without an account. Must exist in the dev database.
const GUEST_EMAIL = "guest@proximity.test";

// Resolve a listing's primary-landlord contact (server-side, never trusting the
// client) for the "have Proxy contact the owner" flow. Falls back to the listing's
// own contact_email when there's no linked landlord account.
async function resolveOwnerForListing(listingId) {
  const { data: row } = await supabase
    .from("listings")
    .select("id, address, title, contact_email, contact_name, listing_landlords(user_id, is_primary)")
    .eq("id", listingId)
    .single();
  if (!row) return null;
  const links = row.listing_landlords ?? [];
  const primary = links.find((l) => l.is_primary) ?? links[0];
  let owner = null;
  if (primary?.user_id) {
    const { data: u } = await supabase.from("users").select("name, email").eq("id", primary.user_id).single();
    owner = u;
  }
  const email = owner?.email || row.contact_email || null;
  if (!email) return null;
  return { email, name: owner?.name || row.contact_name || null, address: row.address, title: row.title };
}

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
//
// @auth optional
//
// Declared rather than inferred: the guard lives here, not as an `if (!session)`
// in each handler, so the knowledge scanner would otherwise read these routes as
// unconditionally guarded and flag the deliberate non-prod guest response as a
// missing auth check. "optional" is the honest label — anonymous callers get a
// safe response off production, and a 401 on it.
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

export async function GET(request) {
  try {
    const { actor, isGuest, error } = await resolveActor(await auth());
    if (error) return NextResponse.json({ error: error.msg }, { status: error.status });

    // The client remembers which session it was in (localStorage). When it asks
    // for that one by id, hand it back — this is how a GUEST resumes: guests all
    // share one identity, so "the latest session for this user" could be another
    // tester's chat, but a session they hold the id for is provably theirs.
    const wanted = new URL(request.url).searchParams.get("sessionId");
    if (wanted) {
      const { data: byId } = await supabase
        .from("matchmaking_chat_sessions")
        .select("*")
        .eq("id", wanted)
        .eq("user_id", actor.id)
        .not("status", "eq", "abandoned")
        .maybeSingle();
      if (byId) return NextResponse.json({ session: byId });
      // Fall through: an unknown/foreign id just means "no session to resume".
    }
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
    const session = await auth();
    const { actor, error: actorError } = await resolveActor(session);
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

    // Rewind to a past TRADEOFF answer. Unlike scripted questions (which the
    // client can rewind on its own), the narrowing state lives server-side, so the
    // server does the work and hands back the question to re-ask.
    if (action === "rewind_tradeoff") {
      const idx = Number(body.tradeoffIndex);
      if (!Number.isInteger(idx) || idx < 0) {
        return NextResponse.json({ error: "Invalid tradeoff index" }, { status: 400 });
      }
      chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor.gender ?? null };
      const turn = await rewindToTradeoff(chatSession, idx);
      return NextResponse.json({
        sessionId: turn.session.id,
        assistantMessage: turn.assistantMessage,
        nextQuestion: turn.nextQuestion,
        preferences: turn.session.preferences,
        weights: turn.session.weights,
        recommendations: turn.session.recommendations ?? [],
        status: turn.session.status,
      });
    }

    // The widening turn (see continueRelaxedSearch): the previous turn told the
    // student we're loosening their filters; this one actually does it and comes
    // back with the new matches.
    if (action === "relax_retry") {
      chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor.gender ?? null };
      const turn = await continueRelaxedSearch(chatSession);
      return NextResponse.json({
        sessionId: turn.session.id,
        assistantMessage: turn.assistantMessage,
        nextQuestion: null,
        preferences: turn.session.preferences,
        weights: turn.session.weights,
        recommendations: turn.recommendations,
        status: turn.session.status,
        mode: "agent",
        reranked: turn.reranked,
        draft: null,
      });
    }

    // Save the client's transcript verbatim. The chat has turns the server never
    // authors (the "want me to email these owners?" offer, a declined offer, an
    // email draft), and a reload rebuilds the window from the stored transcript —
    // so the client posts the whole thing back to keep the history complete.
    if (action === "save_transcript") {
      if (!Array.isArray(transcript)) {
        return NextResponse.json({ error: "transcript is required" }, { status: 400 });
      }
      const { error: saveErr } = await supabase
        .from("matchmaking_chat_sessions")
        .update({ transcript })
        .eq("id", chatSession.id);
      if (saveErr) {
        return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
      }
      return NextResponse.json({ sessionId: chatSession.id });
    }

    // Contact owners: the student picked listings (from their 3 matches) and asked
    // Proxy to reach out. Identity is the signed-in account; outside production an
    // anonymous tester sends as a generic "Proximity Tester" (and every email is
    // redirected to the staging test inbox by sendMailSafe — real owners are never hit).
    if (action === "contact_owners") {
      const listingIds = Array.isArray(body.listingIds) ? [...new Set(body.listingIds.filter(Boolean))] : [];
      const student = session?.user?.email
        ? { name: (session.user.name || actor.name || "A Proximity student").trim(), email: session.user.email }
        : { name: "Proximity Tester", email: GUEST_EMAIL };

      let sent = 0;
      for (const listingId of listingIds) {
        const owner = await resolveOwnerForListing(listingId);
        if (!owner) continue;
        try {
          await sendOwnerInquiryEmail({
            to: owner.email,
            landlordName: owner.name,
            student,
            listingAddress: owner.title || owner.address,
            message: typeof body.message === "string" ? body.message : null,
          });
          sent += 1;
          // Same markup as the browse-page contact flow (POST /api/contacted):
          // contacted interaction + "contacts" listing metric.
          const { error: trackErr } = await recordListingContact({ userId: actor.id, listingId });
          if (trackErr) {
            console.error("[matchmaking/chat contact_owners] contact tracking failed:", trackErr);
          }
        } catch (err) {
          console.error("[matchmaking/chat contact_owners] send failed:", err);
        }
      }

      const assistantMessage =
        sent > 0
          ? `Done! I've emailed ${sent === 1 ? "the owner" : `${sent} owners`} on your behalf and CC'd you (${student.email}), so their replies land straight in your inbox. Anything else I can do? I'm happy to fine-tune your matches, compare these places, or pull up more details on any of them.`
          : "I couldn't reach those owners just now, please try again in a moment. In the meantime, want me to refine your matches or tell you more about any of these places?";

      // Persist the exchange so a page reload still shows that Proxy reached out.
      const newTranscript = [
        ...(chatSession.transcript ?? []),
        { role: "user", content: body.selectionLabel || "Reach out to the selected owners", ts: new Date().toISOString() },
        { role: "assistant", content: assistantMessage, ts: new Date().toISOString() },
      ];
      await supabase
        .from("matchmaking_chat_sessions")
        .update({ transcript: newTranscript })
        .eq("id", chatSession.id);

      return NextResponse.json({ sessionId: chatSession.id, assistantMessage, contactedCount: sent });
    }

    // Stamp the student's account gender onto the session prefs (server-only,
    // hidden key) so the ranker can hard-exclude listings whose descriptions
    // restrict occupants to a gender they aren't. See listingConstraints.
    chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor.gender ?? null };

    const turn = await handleTurn({
      session: chatSession,
      answer: answer ?? null,
      message: message ?? "",
      preferences: preferences ?? null,
      weights: weights ?? null,
      tradeoff: tradeoff ?? null,
    });
    const updatedSession = turn.session;

    return NextResponse.json({
      sessionId: updatedSession.id,
      assistantMessage: turn.assistantMessage,
      nextQuestion: turn.nextQuestion,
      // A standalone remark shown just before the next question (see
      // bigGroupHeadsUp) — rendered as its own bubble, never merged in.
      note: turn.note ?? null,
      preferences: updatedSession.preferences,
      weights: updatedSession.weights,
      recommendations: updatedSession.recommendations,
      status: updatedSession.status,
      // Conversational-agent extras (post-recommendations free-text turns).
      mode: turn.mode ?? null,
      reranked: turn.reranked ?? false,
      draft: turn.draft ?? null,
      // This turn only announced that we're widening the search; the client
      // follows up with action "relax_retry" to get the actual matches.
      pendingRelax: turn.pendingRelax ?? false,
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

    // If the user already has their 3 picks, reordering priorities should refresh
    // them right away rather than waiting for a chat refine.
    let recommendations = chatSession.recommendations;
    let transcript = chatSession.transcript;
    if (chatSession.status === "recommendations_ready") {
      // Never repeat: a panel edit is a preference change, so the currently
      // shown picks are folded into the never-repeat set-aside and the re-rank
      // must surface fresh listings (same policy as the chat agent's
      // update_search). If nothing new fits, the current picks stay and the
      // set-aside is rolled back so it isn't burned for nothing.
      const prevSetAside = updatedPreferences._setAside ?? [];
      const shownNow = (chatSession.recommendations ?? []).map((r) => r.listing_id).filter(Boolean);
      if (shownNow.length) {
        updatedPreferences._setAside = [...new Set([...prevSetAside, ...shownNow])];
      }
      try {
        const fresh = await computeRecommendations(updatedPreferences, updatedWeights);
        if (!fresh.length && shownNow.length) {
          updatedPreferences._setAside = prevSetAside;
        } else {
          recommendations = fresh;
        }
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
        updatedPreferences._setAside = prevSetAside;
      }
    }

    const { error: updateError } = await supabase
      .from("matchmaking_chat_sessions")
      .update({ preferences: updatedPreferences, weights: updatedWeights, recommendations, transcript })
      .eq("id", sessionId);
    if (updateError) {
      return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
    }

    return NextResponse.json({
      sessionId,
      preferences: updatedPreferences,
      weights: updatedWeights,
      recommendations,
      status: chatSession.status,
    });
  } catch (err) {
    console.error("[matchmaking/chat PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
