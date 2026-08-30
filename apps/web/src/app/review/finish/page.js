/*
 * "Finish setting up your account", opened from the email a QR reviewer gets:
 * /review/finish?token=…
 *
 * This is the other-device half of the promise the inline step makes. The token
 * lives for a week, so a student who reviewed a place on their phone outside a
 * dorm can finish the profile on a laptop that never had the tab open.
 *
 * Opening this page also verifies the email address: the link exists nowhere but
 * that inbox, so arriving here proves control of it. The account becomes
 * loggable-in (via Google, or by setting a password) without a second email.
 * Note this is deliberately NOT done for the inline path, which never proved
 * anything about the inbox.
 */
import { redirect } from "next/navigation";
import {
  loadProfileSetupUser,
  markEmailVerifiedFromSetupLink,
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

  await markEmailVerifiedFromSetupLink(found.userId);

  return (
    <div className="max-w-xl mx-auto px-4 py-10 pb-32 sm:pb-40">
      <FinishProfileClient token={String(token)} prefill={found.prefill} />
    </div>
  );
}
