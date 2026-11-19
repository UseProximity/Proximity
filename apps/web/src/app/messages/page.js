/*
 * /messages is no longer a page. The inbox is a URL-driven overlay
 * (components/chat/GlobalMessagesPanel) opened by ?messages=1, so this route
 * exists only to keep older links working: the header used to push here, and
 * every chat notification email sent before the change points at
 * /messages?thread=<id>.
 *
 * Redirect rather than render, so there is one inbox surface instead of two that
 * can drift apart visually. The thread parameter is carried across, which is the
 * whole point for an email link, and so are the email's campaign tags
 * (marketing attribution), which the session beacon reads on the page it lands on.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { withCampaignParams } from "@/lib/marketing/tags";

export const metadata = {
  title: "Messages | Proximity",
  description: "Your listing conversations on Proximity.",
  robots: { index: false, follow: false },
};

export default async function MessagesPage({ searchParams }) {
  const params = await searchParams;
  const thread = typeof params?.thread === "string" ? params.thread : null;

  const target = withCampaignParams(
    thread ? `/?messages=1&thread=${encodeURIComponent(thread)}` : "/?messages=1",
    params
  );

  const session = await auth();
  if (!session?.user?.id) {
    // Sign in, then land on the overlay rather than back on this redirect.
    // The tags go on the login URL too, so the visit is classified on landing.
    redirect(withCampaignParams(`/login?callbackUrl=${encodeURIComponent(target)}`, params));
  }

  redirect(target);
}
