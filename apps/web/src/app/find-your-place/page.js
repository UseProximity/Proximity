import Footer from "@/components/layout/Footer";
import FindYourPlaceClient from "@/components/findYourPlace/FindYourPlaceClient";

export const metadata = {
  title: "Find Your Place | Proximity",
  description:
    "Answer a few questions and get your top off-campus housing matches near WashU, free.",
  alternates: { canonical: "/find-your-place" },
};

export default function FindYourPlacePage() {
  return (
    <>
      <FindYourPlaceClient />
      <Footer />
    </>
  );
}
