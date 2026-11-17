import { redirect } from "next/navigation";

// The chat-style matchmaking page became the Find Your Place flow (2026-11-10).
// Old links, guides and emails still point here, so send them on.
export default function MatchmakingPage() {
  redirect("/find-your-place");
}
