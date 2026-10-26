import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRequestUser, RequestUserLookupError } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { handleTurn, computeRecommendations, continueRelaxedSearch, rewindToTradeoff } from "@/lib/matchmaking/chatOrchestrator";
import { sendOwnerInquiryEmail } from "@/lib/email";
import { recordListingContact } from "@/lib/contactTracking";
import { clientIp } from "@/lib/auth/loginThrottle";
import {
  readVisitorId,
  newVisitorId,
  setVisitorCookie,
  anonIpLimited,
  triesLeftFor,
  visitorSessionById,
  latestVisitorSession,
  ownsAsVisitor,
  abandonUnfinishedVisitorSessions,
  claimVisitorSessions,
  countClaimableSessions,
  withHiddenPreferences,
  withLatestRecommendations,
  isLockedStatus,
  lockSessionForVisitor,
  lockTurnForVisitor,
} from "@/lib/matchmaking/anonymousSessions";

// Resolve a listing's primary-landlord contact (server-side, never trusting the
// client) for the "have Proxy contact the owner" flow. The address follows the
// same rule as chat alerts (fn_landlord_contact_email): the listing's confirmed
// contact email first, else the account email. Falls back to the listing's own
// contact_email when there's no linked landlord account.
async function resolveOwnerForListing(listingId) {
  const { data: row } = await supabase
    .from("listings")
    .select("id, address, title, contact_email, contact_name, listing_landlords(user_id, is_primary)")
    .eq("id", listingId)
    .is("deleted_at", null)
    .single();
  if (!row) return null;
  const links = row.listing_landlords ?? [];
  const primary = links.find((l) => l.is_primary) ?? links[0];
  let owner = null;
  let routed = null;
  if (primary?.user_id) {
    const { data: u } = await supabase.from("users").select("name, email").eq("id", primary.user_id).single();
    owner = u;
    const { data: route } = await supabase.rpc("fn_landlord_contact_email", {
      p_landlord_id: primary.user_id,
      p_listing_id: listingId,
      p_lease_id: null,
    });
    routed = typeof route === "string" ? route.trim() : "";
  }
  const email = routed || owner?.email || row.contact_email || null;
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
// With no session the caller is an anonymous VISITOR, identified by the prx_vid
// device cookie (null until their first chat sets it): they can run the whole
// chat, but the picks stay locked until an account claims the session. See
// lib/matchmaking/anonymousSessions.js.
//
// @auth optional
//
// Declared rather than inferred: the guard lives here, not as an `if (!session)`
// in each handler, so the knowledge scanner would otherwise read these routes as
// unconditionally guarded. "optional" is the honest label: anonymous web callers
// get the locked visitor flow, and only a bad Bearer token is a 401.
//
// `requestUser` is the web session or a mobile Bearer token (getRequestUser). A request
// that sent a Bearer token which did not resolve (expired or invalid) is a real 401,
// never a visitor: the mobile client's refresh-and-retry depends on it.
async function resolveActor(requestUser, request) {
  if (requestUser?.email) {
    const user = await resolveUserId(requestUser.email);
    if (!user) return { error: { msg: "User not found", status: 404 } };
    // The cookie rides along for a signed-in caller too: the "claim" action needs
    // it to find the chats this browser ran signed out.
    return { actor: user, visitor: readVisitorId(request) };
  }
  // Any Bearer header counts, including an empty or malformed one.
  const sentBearer = /^bearer\b/i.test(request?.headers?.get("authorization") ?? "");
  if (sentBearer) return { error: { msg: "Unauthorized", status: 401 } };
  return { actor: null, visitor: readVisitorId(request) };
}

// Does this session belong to whoever is asking? Accounts own by user_id;
// visitors own only unclaimed rows from their own cookie.
function owns(chatSession, actor, visitor) {
  return actor ? chatSession.user_id === actor.id : ownsAsVisitor(chatSession, visitor);
}

export async function GET(request) {
  try {
    const { actor, visitor, error } = await resolveActor(await getRequestUser(request), request);
    if (error) return NextResponse.json({ error: error.msg }, { status: error.status });

    const wanted = new URL(request.url).searchParams.get("sessionId");

    if (!actor) {
      // No cookie yet means no chats yet. Deliberately NOT setting one here: the
      // homepage asks this endpoint whether a chat exists, and a cookie should
      // only ever be minted when a chat actually starts (POST).
      if (!visitor) return NextResponse.json({ session: null, anonymous: true, triesLeft: await triesLeftFor(null) });
      const session = (wanted && (await visitorSessionById(visitor, wanted))) || (await latestVisitorSession(visitor));
      return NextResponse.json({
        session: lockSessionForVisitor(session),
        anonymous: true,
        triesLeft: await triesLeftFor(visitor),
      });
    }

    // The chat page (not the homepage) asks whether this browser holds signed-out
    // chats no account owns yet, to offer "add this chat to your account?".
    // Nothing is claimed here: that takes the account's say-so (POST "claim").
    const claimable = new URL(request.url).searchParams.get("claimable")
      ? { claimable: await countClaimableSessions(visitor) }
      : {};

    // The client remembers which session it was in (localStorage). When it asks
    // for that one by id, hand it back; an unknown/foreign id just means "no
    // session to resume" and falls through to the latest.
    if (wanted) {
      const { data: byId } = await supabase
        .from("matchmaking_chat_sessions")
        .select("*")
        .eq("id", wanted)
        .eq("user_id", actor.id)
        .not("status", "eq", "abandoned")
        .maybeSingle();
      if (byId) return NextResponse.json({ session: byId, ...claimable });
    }

    const { data: chatSession } = await supabase
      .from("matchmaking_chat_sessions")
      .select("*")
      .eq("user_id", actor.id)
      .not("status", "eq", "abandoned")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ session: chatSession ?? null, ...claimable });
  } catch (err) {
    console.error("[matchmaking/chat GET]", err);
    // A failed user lookup is not "no session": answering 200 with null would make the
    // mobile app start a fresh conversation over the one it could not load.
    if (err instanceof RequestUserLookupError) {
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    return NextResponse.json({ session: null });
  }
}

export async function POST(request) {
  try {
    const requestUser = await getRequestUser(request);
    const { actor, visitor: cookieVisitor, error: actorError } = await resolveActor(requestUser, request);
    if (actorError) return NextResponse.json({ error: actorError.msg }, { status: actorError.status });

    const body = await request.json();
    const { sessionId, message, answer, preferences, weights, action, transcript, tradeoff } = body;

    // A visitor's first chat mints their device cookie; it rides out on whatever
    // response this request ends with, so every return below goes through `respond`.
    let visitor = cookieVisitor;
    let mintedVisitor = null;
    const respond = (payload, init) => {
      const res = NextResponse.json(payload, init);
      return mintedVisitor ? setVisitorCookie(res, mintedVisitor) : res;
    };
    // Anonymous responses never carry the picks (see lockTurnForVisitor).
    const reply = (payload, init) => respond(actor ? payload : lockTurnForVisitor(payload), init);

    // Take over the chats this browser ran signed out. Only ever on request: the
    // client sends it on the way back from the sign-up wall, or when the student
    // says yes to "add this chat to your account?". Never automatic, so whoever
    // signs in next on a shared computer does not inherit someone else's chat.
    if (action === "claim") {
      if (!actor) return respond({ error: "Sign in to save this chat" }, { status: 401 });
      return respond(await claimVisitorSessions(actor, cookieVisitor));
    }

    let chatSession;

    if (sessionId) {
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error || !data) {
        return respond({ error: "Session not found" }, { status: 404 });
      }
      if (!owns(data, actor, visitor)) {
        return respond({ error: "Forbidden" }, { status: 403 });
      }
      chatSession = data;
    } else if (actor) {
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .insert({
          user_id: actor.id,
          // The chat no longer asks for a name; the account's first name is used
          // where Proxy addresses the student or signs an owner email.
          preferences: { name: (actor.name ?? "").trim().split(/\s+/)[0] ?? "" },
          weights: {},
          transcript: [],
          recommendations: [],
          status: "in_progress",
        })
        .select()
        .single();
      if (error) {
        return respond({ error: "Failed to create session" }, { status: 500 });
      }
      chatSession = data;
    } else {
      // Anonymous chat start. Cap first (by cookie), then the soft IP guard, then
      // one live chat per device: "start over" abandons the unfinished one.
      if (!visitor) {
        visitor = newVisitorId();
        mintedVisitor = visitor;
      }
      const triesLeft = await triesLeftFor(visitor);
      if (triesLeft <= 0) {
        return respond({ error: "cap_reached", triesLeft: 0 }, { status: 429 });
      }
      if (anonIpLimited(clientIp(request.headers))) {
        return respond({ error: "rate_limited", triesLeft }, { status: 429 });
      }
      await abandonUnfinishedVisitorSessions(visitor);
      const { data, error } = await supabase
        .from("matchmaking_chat_sessions")
        .insert({
          user_id: null,
          visitor_id: visitor,
          preferences: {},
          weights: {},
          transcript: [],
          recommendations: [],
          status: "in_progress",
        })
        .select()
        .single();
      if (error) {
        return respond({ error: "Failed to create session" }, { status: 500 });
      }
      chatSession = data;
    }

    // Once a visitor's picks exist the chat is read-only until an account claims
    // it: no edits, no refines, no emails (Wyatt, 2026-10-20). The transcript
    // mirror is answered but ignored, since the client's copy of a locked chat is
    // the stripped one and must never overwrite the stored picks.
    if (!actor && isLockedStatus(chatSession.status)) {
      if (action === "save_transcript") return respond({ sessionId: chatSession.id, locked: true });
      return respond({ error: "locked", locked: true }, { status: 403 });
    }

    // Rewind: the user clicked "edit" on a past prompt. Replace the session's
    // prefs/weights/transcript with the client's truncated, authoritative copy.
    if (action === "rewind") {
      // A visitor's client only ever held the stripped preferences (see the lock),
      // so the narrowing state comes back from the stored copy, not the echo.
      const rewoundPrefs =
        preferences && !actor ? withHiddenPreferences(preferences, chatSession.preferences) : preferences;
      const { error: rewindErr } = await supabase
        .from("matchmaking_chat_sessions")
        .update({
          preferences: rewoundPrefs ?? chatSession.preferences,
          weights: weights ?? chatSession.weights,
          transcript: transcript ?? chatSession.transcript,
          recommendations: [],
          status: "in_progress",
        })
        .eq("id", chatSession.id);
      if (rewindErr) {
        return respond({ error: "Failed to rewind session" }, { status: 500 });
      }
      return respond({ sessionId: chatSession.id, status: "in_progress", nextQuestion: null });
    }

    // Rewind to a past TRADEOFF answer. Unlike scripted questions (which the
    // client can rewind on its own), the narrowing state lives server-side, so the
    // server does the work and hands back the question to re-ask.
    if (action === "rewind_tradeoff") {
      const idx = Number(body.tradeoffIndex);
      if (!Number.isInteger(idx) || idx < 0) {
        return respond({ error: "Invalid tradeoff index" }, { status: 400 });
      }
      chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor?.gender ?? null };
      const turn = await rewindToTradeoff(chatSession, idx);
      return reply({
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
      chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor?.gender ?? null };
      const turn = await continueRelaxedSearch(chatSession);
      return reply({
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
    // email draft), and a reload rebuilds the window from the stored transcript,
    // so the client posts the whole thing back to keep the history complete.
    if (action === "save_transcript") {
      if (!Array.isArray(transcript)) {
        return respond({ error: "transcript is required" }, { status: 400 });
      }
      const { error: saveErr } = await supabase
        .from("matchmaking_chat_sessions")
        .update({ transcript })
        .eq("id", chatSession.id);
      if (saveErr) {
        return respond({ error: "Failed to save transcript" }, { status: 500 });
      }
      return respond({ sessionId: chatSession.id });
    }

    // Contact owners: the student picked listings (from their 3 matches) and asked
    // Proxy to reach out. Identity is the signed-in account; a visitor never gets
    // here (their chat is locked before the offer is made).
    if (action === "contact_owners") {
      if (!actor) return respond({ error: "Sign in to contact owners" }, { status: 403 });
      /*
       * Only listings this chat actually recommended. The ids come from the
       * client, and without this anyone signed in could email (and, through the
       * CC, learn the address of) the owner of every listing on the site in one
       * request. recommendations is server-written; the transcript is not.
       */
      const recommended = new Set(
        (chatSession.recommendations ?? []).map((r) => r?.listing_id).filter(Boolean)
      );
      const listingIds = Array.isArray(body.listingIds)
        ? [...new Set(body.listingIds.filter((id) => recommended.has(id)))]
        : [];
      // The web session carries the display name; a mobile Bearer token has none.
      const sessionName = (await auth())?.user?.name;
      const student = { name: (sessionName || actor.name || "A Proximity student").trim(), email: requestUser.email };

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
            req: request,
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
          ? `Done! I've emailed ${sent === 1 ? "the owner" : `${sent} owners`} on your behalf and CC'd you, so their replies land straight in your inbox. Anything else I can do? I'm happy to fine-tune your matches, compare these places, or pull up more details on any of them.`
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

      return respond({ sessionId: chatSession.id, assistantMessage, contactedCount: sent });
    }

    // Stamp the student's account gender onto the session prefs (server-only,
    // hidden key) so the ranker can hard-exclude listings whose descriptions
    // restrict occupants to a gender they aren't. See listingConstraints. A
    // visitor has none, which keeps every gender-restricted listing out of
    // their picks until the claim re-ranks with the account's gender.
    chatSession.preferences = { ...(chatSession.preferences ?? {}), _viewerGender: actor?.gender ?? null };

    const turn = await handleTurn({
      session: chatSession,
      answer: answer ?? null,
      message: message ?? "",
      preferences: preferences ?? null,
      weights: weights ?? null,
      tradeoff: tradeoff ?? null,
    });
    const updatedSession = turn.session;

    return reply({
      sessionId: updatedSession.id,
      assistantMessage: turn.assistantMessage,
      nextQuestion: turn.nextQuestion,
      // A standalone remark shown just before the next question (see
      // bigGroupHeadsUp), rendered as its own bubble, never merged in.
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
      // How many fresh chats this device has left, so the wall can say so.
      ...(actor ? {} : { triesLeft: await triesLeftFor(visitor) }),
    });
  } catch (err) {
    console.error("[matchmaking/chat POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { actor, visitor, error: actorError } = await resolveActor(await getRequestUser(request), request);
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
    if (!owns(chatSession, actor, visitor)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // A visitor's finished chat is read-only until claimed (see POST).
    if (!actor && isLockedStatus(chatSession.status)) {
      return NextResponse.json({ error: "locked", locked: true }, { status: 403 });
    }

    const updatedPreferences = { ...chatSession.preferences, ...patch, _viewerGender: actor?.gender ?? null };
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
        transcript = withLatestRecommendations(transcript, recommendations);
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

    const payload = {
      sessionId,
      preferences: updatedPreferences,
      weights: updatedWeights,
      recommendations,
      status: chatSession.status,
    };
    return NextResponse.json(actor ? payload : lockTurnForVisitor(payload));
  } catch (err) {
    console.error("[matchmaking/chat PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
