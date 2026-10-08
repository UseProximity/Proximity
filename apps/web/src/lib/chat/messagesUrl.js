/*
 * The messages overlay lives in the URL, the same way the listing modal does
 * (see components/listings/GlobalListingModal).
 *
 *   ?messages=1              inbox open
 *   ?messages=1&thread=<id>  that conversation open
 *
 * Keeping it in the URL rather than in component state is what makes opening a
 * conversation a real navigation: the back button closes it, the link is
 * shareable, and the step from "sent an enquiry" to "in the conversation" shows
 * up in analytics instead of being invisible (Wyatt, 2026-10-03).
 *
 * Helpers rather than inline URLSearchParams juggling, because the header, the
 * listing modal, the overlay itself and the /messages redirect all have to agree
 * on the parameter names.
 *
 * withMessages/withoutMessages return the QUERY ONLY, leading "?" included.
 * Callers prepend the pathname, the same shape GlobalListingModal uses, so a
 * query-only push can never resolve against the wrong route.
 */
export const MESSAGES_PARAM = "messages";
export const THREAD_PARAM = "thread";

/** True when the overlay should be open for these params. */
export function messagesOpen(searchParams) {
  return Boolean(searchParams?.get(MESSAGES_PARAM));
}

/** The thread to show, or null for the inbox. */
export function openThreadId(searchParams) {
  return searchParams?.get(THREAD_PARAM) || null;
}

/**
 * Add the messages params to the current query, preserving everything else.
 *
 * `listing` is dropped on purpose: the listing modal and the messages overlay
 * are both full-screen on a phone, and leaving both params set would stack them.
 * Sending an enquiry is a move from the listing into the conversation.
 */
export function withMessages(searchParams, threadId = null) {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  params.set(MESSAGES_PARAM, "1");
  params.delete("listing");
  if (threadId) params.set(THREAD_PARAM, threadId);
  else params.delete(THREAD_PARAM);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Remove the messages params, leaving the rest of the query intact. */
export function withoutMessages(searchParams) {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  params.delete(MESSAGES_PARAM);
  params.delete(THREAD_PARAM);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
