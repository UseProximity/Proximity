/*
 * /messages is no longer a page. The inbox is a URL-driven overlay
 * (components/chat/GlobalMessagesPanel) opened by ?messages=1, so this route
 * exists only to keep older links working: the header used to push here, and
 * every chat notification email sent before the change points at
 * /messages?thread=<id>.
 *
 * Redirect rather than render, so there is one inbox surface instead of two that
 * can drift apart visually. The thread parameter is carried across, which is the
 * whole point for an email link.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const metadata = {
  title: "Messages | Proximity",
  description: "Your listing conversations on Proximity.",
  robots: { index: false, follow: false },
};

export default async function MessagesPage({ searchParams }) {
  const params = await searchParams;
  const thread = typeof params?.thread === "string" ? params.thread : null;

  const target = thread
    ? `/?messages=1&thread=${encodeURIComponent(thread)}`
    : "/?messages=1";

  const session = await auth();
  if (!session?.user?.id) {
    // Sign in, then land on the overlay rather than back on this redirect.
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`);
  }

  redirect(target);
}
