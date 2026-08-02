import Footer from "@/components/layout/Footer";

// The /guides index page is a client component and can't export metadata,
// so the segment default lives here. Guide detail pages override it with
// their own metadata exports.
export const metadata = {
  title: "WashU Off-Campus Housing Guides | Proximity",
  description:
    "Guides to finding off-campus housing near WashU: budgeting, lease checklists, move-in tips, housing types, and advice for parents — written by students.",
};

export default function GuidesLayout({ children }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
