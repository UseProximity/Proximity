/*
 * /contact-verify: confirm an address for per-listing message alerts.
 *
 * The link is looked up here but only redeemed by the button, so a mail scanner
 * that prefetches it (Outlook Safe Links and similar) cannot confirm an address
 * on its owner's behalf. No sign-in needed: clicking a link sent to the address
 * is the proof.
 */
import { peekContactVerification } from "@/lib/chat/contactVerification";
import ContactVerifyClient from "./ContactVerifyClient";

export const metadata = {
  title: "Confirm alert address | Proximity",
  robots: { index: false, follow: false },
};

export default async function ContactVerifyPage({ searchParams }) {
  const { token } = await searchParams;
  const peek = await peekContactVerification(token);

  return (
    <ContactVerifyClient
      token={typeof token === "string" ? token : ""}
      email={peek?.email ?? null}
      landlordName={peek?.landlordName ?? null}
      alreadyConfirmed={Boolean(peek?.confirmed)}
      valid={Boolean(peek)}
    />
  );
}
