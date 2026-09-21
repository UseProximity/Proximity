/*
 * Shared shell for the published legal pages (/privacy, /terms). The Header is
 * mounted globally in the root layout, so this only adds the Footer, the same
 * arrangement /guides uses.
 */
import Footer from "@/components/layout/Footer";

export default function LegalLayout({ children }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
