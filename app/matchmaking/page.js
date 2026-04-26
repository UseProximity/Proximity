import Footer from "@/components/Footer";
import ConciergeFormClient from "./concierge-form-client";

export const metadata = {
  title: "Free WashU Housing Matching — Tell Us What You Need | Proximity",
  description:
    "Tell us what you're looking for and get free personalized off-campus housing recommendations.",
};

export default function MatchmakingPage() {
  return (
    <>
      <ConciergeFormClient />
      <Footer />
    </>
  );
}
