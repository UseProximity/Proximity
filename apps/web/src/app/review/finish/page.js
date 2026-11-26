/*
 * "Finish setting up your account", opened from the email a QR reviewer gets:
 * /review/finish?token=…
 *
 * This is the other-device half of the promise the inline step makes. The token
 * lives for a week, so a student who reviewed a place on their phone outside a
 * dorm can finish the profile on a laptop that never had the tab open.
 *
 * Opening this page with the emailed link token also verifies the email address:
 * that token exists nowhere but that inbox, so arriving with it proves control of
 * it. The account becomes loggable-in (via Google, or by setting a password)
 * without a second email. Deliberately NOT done for the inline token, which was
 * handed to whoever submitted the form and proves nothing about the inbox.
 */
import { redirect } from "next/navigation";
import {
  loadProfileSetupUser,
  markEmailVerifiedFromLink,
} from "@/lib/reviews/onboarding";
import FinishProfileClient from "./FinishProfileClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Finish Your Profile | Proximity",
  robots: { index: false, follow: false },
};

export default async function FinishProfilePage({ searchParams }) {
  const { token } = await searchParams;
  const found = await loadProfileSetupUser(token);

  /*
   * A dead token is usually a profile that's already finished, so send them
   * somewhere useful rather than showing an error about a link they can't fix.
   */
  if (!found) redirect("/?profileSetup=expired");

  /*
   * Only the emailed link token proves the inbox. The inline token (the
   * waitlist dialog also links here with it) still opens the profile form, but
   * verifies nothing, because it was handed to whoever typed the address.
   * Verifying an unverified account wipes any password set before the inbox
   * was proven, so the account step is offered again in that case.
   */
  let hasCredentials = found.hasCredentials;
  if (found.viaEmailLink) {
    await markEmailVerifiedFromLink(found.userId);
    if (!found.emailVerified) hasCredentials = found.hasProviderLogin;
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10 pb-32 sm:pb-40">
      <FinishProfileClient
        token={String(token)}
        prefill={found.prefill}
        email={found.email}
        hasCredentials={hasCredentials}
        canSetPassword={found.viaEmailLink || found.emailVerified}
      />
    </div>
  );
}
