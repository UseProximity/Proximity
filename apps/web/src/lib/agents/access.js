/*
 * Who is talking to Proxy on this request, and in what capacity.
 *
 *   student      a signed-in account (web session or mobile token)
 *   visitor      a signed-out browser, named by the prx_vid cookie; a first
 *                visit mints one, and the route sets it on its response
 *   tester       a landlord looking at their own listing: real answers,
 *                nothing logged, counted or sent to a landlord
 *                (PRD: "Test mode")
 *
 * Proxy is on for a listing only when both switches are on (lib/agents/flags).
 * Staff (super, admin) talk to Proxy as a normal student on a live listing they
 * do not own, so their questions reach the landlord and count like anyone's.
 * On a listing that is unpublished or whose Proxy is not live yet, staff get
 * test mode instead, so a pilot can be tried before it is turned on.
 */
import supabase from "@/lib/supabase";
import { getRequestUser } from "@/lib/getRequestUser";
import { readVisitorId, newVisitorId, setVisitorCookie } from "@/lib/visitorCookie";
import { agentsEnabled, agentIsLive } from "./flags";
import { getAgent } from "./store";

export async function proxyActor(req) {
  const user = await getRequestUser(req);
  let visitorId = readVisitorId(req);
  let minted = null;
  if (!user && !visitorId) {
    visitorId = newVisitorId();
    minted = visitorId;
  }
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    visitorId: user ? null : visitorId,
    // The cookie the signed-in user still carries, for claiming visitor threads.
    cookieVisitorId: readVisitorId(req),
    withCookie: (res) => (minted ? setVisitorCookie(res, minted) : res),
  };
}

const isStaff = (role) => role === "super" || role === "admin";

/*
 * Who was really talking in a Proxy chat, for the admin view: "landlord" or
 * "staff" when the chat ran in test mode, null for a real student. Whether it
 * was a test comes from the outcome recorded with each question at the time
 * (listing_agent_questions.outcome = "test"), not from who owns the listing
 * now, so staff asking on a live listing (questions really sent) and someone
 * who claims a listing after chatting on it as a student keep their true label.
 * Pure, so the admin routes can pass their own lookups.
 */
export function testingAs(user, { wasTest, ownsThisListing }) {
  if (!user || !wasTest) return null;
  return isStaff(user.role) && !ownsThisListing ? "staff" : "landlord";
}

async function ownsListing({ userId, listingId }) {
  if (!userId) return false;
  const { data } = await supabase.from("listing_landlords").select("listing_id").eq("listing_id", listingId).eq("user_id", userId).limit(1);
  return (data ?? []).length > 0;
}

/*
 * Whether this person may talk to Proxy on this listing. Returns
 * { ok, testMode, testAs, listing } or { ok: false, status, error }.
 */
export async function proxyAvailable({ listingId, userId, role }) {
  if (!agentsEnabled()) return { ok: false, status: 404, error: "Proxy is not available yet." };
  const { data: listing } = await supabase.from("listings").select("id, deleted_at, published_at, title, address").eq("id", listingId).maybeSingle();
  if (!listing || listing.deleted_at) return { ok: false, status: 404, error: "Listing not found." };
  const [owner, agent] = await Promise.all([ownsListing({ userId, listingId }), getAgent(listingId)]);
  const live = !!listing.published_at && agentIsLive(agent);
  const testMode = owner || (!!userId && isStaff(role) && !live);
  if (!listing.published_at && !testMode) return { ok: false, status: 404, error: "Listing not found." };
  if (!agentIsLive(agent) && !testMode) return { ok: false, status: 404, error: "Proxy is not available on this listing yet." };
  // Who the test is for decides how Proxy words "nothing was sent" (staff do not own the listing).
  return { ok: true, testMode, testAs: !testMode ? null : owner ? "landlord" : "staff", listing, agent };
}
