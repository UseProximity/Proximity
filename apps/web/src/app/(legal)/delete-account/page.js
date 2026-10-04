/*
 * /delete-account: the public account-deletion page (also the URL given to
 * Google Play as the external deletion resource).
 *
 * Public on purpose: anyone can read what deletion does and how to ask for it.
 * It adds no deletion logic of its own. A signed-in visitor gets the existing
 * DeleteAccountButton, which calls DELETE /api/account like the dashboards do;
 * a signed-out visitor is sent through /login and returned here. The retention
 * wording mirrors Privacy Policy section 8, which stays the source of truth.
 */
import Link from "next/link";
import { auth } from "@/auth";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";

export const metadata = {
  title: "Delete your account | Proximity",
  description:
    "How to delete your Proximity account and what happens to your data. Applies to the Proximity website and mobile apps.",
  alternates: { canonical: "/delete-account" },
};

const linkClass =
  "font-medium text-rose-600 underline underline-offset-2 hover:text-rose-700";

export default async function DeleteAccountPage() {
  const session = await auth();
  // A deleted account keeps a truthy session object with no id (see auth.js), so
  // check the id, not the object, the same way /login does.
  const signedIn = Boolean(session?.user?.id);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="border-b border-gray-200 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
            Delete your Proximity account
          </h1>
          <p className="mt-3 text-base text-gray-600">
            You can delete your Proximity account and its associated data at any time. The
            same account is used on the Proximity website and the Proximity mobile apps, so
            deleting it removes it everywhere.
          </p>
        </header>

        <section className="mt-8">
          <h2 className="text-xl font-semibold text-gray-950">How to delete your account</h2>
          {signedIn ? (
            <>
              <p className="mt-2 text-sm text-gray-600">
                You are signed in. Use the button below to delete your account. You will be
                asked to confirm first.
              </p>
              <DeleteAccountButton className="!mt-4 !border-t-0 !pt-0" />
            </>
          ) : (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
                <li>Sign in to your Proximity account.</li>
                <li>You will come back to this page. Choose Delete account and confirm.</li>
              </ol>
              <Link
                href={`/login?callbackUrl=${encodeURIComponent("/delete-account")}`}
                className="mt-4 inline-block rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Sign in to delete my account
              </Link>
            </>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-gray-950">What happens when you delete</h2>
          <h3 className="mt-4 text-base font-semibold text-gray-900">Immediately</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
            <li>Your account stops working and you are signed out.</li>
            <li>Your profile disappears from Proximity.</li>
            <li>Listings you owned alone are withdrawn from the marketplace.</li>
            <li>
              Listings you co-owned with another landlord stay live under that co-owner, and
              you are removed as an owner.
            </li>
          </ul>

          <h3 className="mt-5 text-base font-semibold text-gray-900">After 30 days</h3>
          <p className="mt-2 text-sm text-gray-600">
            An automated job permanently erases your personal data, including your name, email
            address, phone number, date of birth, gender, profile photos, graduation details
            and sign-in credentials. Your saved listings, review votes, Lease Check results,
            waitlist entries and review invitations are also deleted.
          </p>

          <h3 className="mt-5 text-base font-semibold text-gray-900">What we keep, and for how long</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
            <li>
              <strong>Reviews you wrote</strong> stay published, but are anonymized: your name
              and email address are removed and the review is disconnected from your account.
            </li>
            <li>
              <strong>For three years after deletion, then erased:</strong> messages you sent
              through Proximity and inquiries you sent to landlords (with your name and email
              address), leases a landlord told us you signed, your matchmaking conversations
              and the preferences derived from them, and the name and email address on any
              listing you owned alone.
            </li>
            <li>
              <strong>Internal change history:</strong> the personal information is erased,
              but a record that a change happened, and when, is kept for security and audit
              purposes.
            </li>
          </ul>
          <p className="mt-4 text-sm text-gray-600">
            Deletion cannot be undone. Full details are in section 8 of our{" "}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section className="mt-10 border-t border-gray-200 pt-8">
          <h2 className="text-xl font-semibold text-gray-950">Can&apos;t sign in?</h2>
          <p className="mt-2 text-sm text-gray-600">
            Email{" "}
            <a href="mailto:info@useproximity.org" className={linkClass}>
              info@useproximity.org
            </a>{" "}
            from the email address on your account and ask us to delete it.
          </p>
        </section>
      </div>
    </main>
  );
}
