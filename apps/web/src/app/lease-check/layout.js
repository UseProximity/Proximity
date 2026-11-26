import Footer from "@/components/layout/Footer";

/*
 * Signed-out visitors are let in on purpose, same reasoning as add-listing: they can
 * pick their lease and are only asked for an account when they press Check My Lease.
 * Until then the files never leave their browser (lib/leaseCheck/pendingCheck). The
 * API route refuses every step (presign, analyze, history) without a session too.
 */
export default function LeaseCheckLayout({ children }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
