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
import { LegalShell, legalLinkClass as linkClass } from "../LegalPage";

export const metadata = {
  title: "Delete your account | Proximity",
  description:
    "How to delete your Proximity account and what happens to your data. Applies to the Proximity website and mobile apps.",
  alternates: { canonical: "/delete-account" },
};

export default async function DeleteAccountPage() {
  const session = await auth();
  // A deleted account keeps a truthy session object with no id (see auth.js), so
  // check the id, not the object, the same way /login does.
  const signedIn = Boolean(session?.user?.id);

  return (
    <LegalShell
      title="Delete your Proximity account"
      intro={
        <p className="mt-3 text-base text-gray-600">
          You can delete your Proximity account and its associated data at any time. The
          same account is used on the Proximity website and the Proximity mobile apps, so
          deleting it removes it everywhere.
        </p>
      }
    >
      <section className="mt-8">
        <h2 className="text-xl font-semibold text-gray-950">How to delete your account</h2>
        {signedIn ? (
          <>
            <p className="mt-2 text-sm text-gray-600">
              You are signed in. Use the button below to delete your account. You will be
              asked to confirm first.
            </p>
            <DeleteAccountButton className="mt-4" />
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
            you are removed as an owner. If the listing showed your contact details, they
            are replaced with the co-owner&apos;s.
          </li>
          <li>
            Your email address stays reserved for 30 days, so it can&apos;t be used to
            create a new account until the erasure below is complete.
          </li>
        </ul>

        <h3 className="mt-5 text-base font-semibold text-gray-900">After 30 days</h3>
        <p className="mt-2 text-sm text-gray-600">
          An automated job permanently erases your personal data, including your name, email
          address, phone number, date of birth, gender, profile photos, graduation details
          and sign-in credentials. Your saved listings, review votes, blocks you set, reports
          you filed, Lease Check results, waitlist entries and review invitations are also
          deleted. Your email address is then released, so you can sign up again in future.
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
        <h3 className="mt-5 text-base font-semibold text-gray-900">Important limits</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            There is no undo in the app. If you delete your account by mistake, email{" "}
            <a href="mailto:info@useproximity.org" className={linkClass}>
              info@useproximity.org
            </a>{" "}
            within 30 days and we will do what we can, but we cannot promise recovery.
            After 30 days, deletion is irreversible.
          </li>
          <li>
            Emails you already sent to a landlord are in their inbox and cannot be
            recalled.
          </li>
        </ul>
        <p className="mt-4 text-sm text-gray-600">
          Full details are in section 8 of our{" "}
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
    </LegalShell>
  );
}
