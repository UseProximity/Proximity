import Footer from "@/components/layout/Footer";

/*
 * Signed-out visitors are let in on purpose, same reasoning as add-listing: they can
 * upload and fill out the whole check, and are only asked for an account when they
 * press Check My Lease. LeaseCheckClient gates the analysis itself (the expensive,
 * paid step); the API route (api/lease-check PUT) refuses it with no session too.
 */
export default function LeaseCheckLayout({ children }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
