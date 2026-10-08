import { auth } from "@/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LoginClient from "./LoginClient";
import { sanitizeCallbackUrl, toSameSitePath } from "@/lib/auth/callbackUrl";

function configuredAuthHost() {
  try {
    return new URL(process.env.AUTH_URL || process.env.NEXTAUTH_URL).host;
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const h = await headers();
  const callbackUrl = sanitizeCallbackUrl(
    toSameSitePath(params?.callbackUrl, [
      h.get("x-forwarded-host"),
      h.get("host"),
      configuredAuthHost(),
    ])
  );
  const initialTab = params?.tab === "signup" ? "signup" : "signin";

  const session = await auth();
  // A deleted account keeps a truthy session object (see auth.js's session
  // callback) but with no id. Checking bare truthiness here would bounce that
  // session straight to callbackUrl, which dashboard/layout.js now redirects
  // right back to /login for the same reason — an infinite loop.
  if (session?.user?.id) {
    redirect(callbackUrl);
  }

  return <LoginClient callbackUrl={callbackUrl} initialTab={initialTab} />;
}
