import Footer from "@/components/layout/Footer";
import ChatClient from "@/components/matchmaking/ChatClient";

export const metadata = {
  title: "Find Your Place — Housing Matchmaking | Proximity",
  description:
    "Chat with Proxy to get free personalized off-campus housing recommendations near WashU.",
};

export default function MatchmakingPage() {
  return (
    <>
      <ChatClient />
      <Footer />
    </>
  );
}
