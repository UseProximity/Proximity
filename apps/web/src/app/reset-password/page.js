import ResetPasswordClient from "./ResetPasswordClient";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  const token = params?.token ?? "";
  // Where to go after signing in (a payer's invite lands on Billing). A path on this site only.
  const next = params?.next ? sanitizeCallbackUrl(params.next, "") : "";
  return <ResetPasswordClient token={token} next={next} />;
}
