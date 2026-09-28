export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isApiProvider, getConnector } from "@/lib/pms/index.js";
import { createConnectSession } from "@/lib/pms/nango.js";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

// POST /api/landlord/pms/connect-session — mint a Nango Connect UI session
// token for one provider. The landlord enters their PMS credential in NANGO's
// hosted window; it never touches Proximity.
export async function POST(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { provider } = await req.json().catch(() => ({}));
  if (!isApiProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  try {
    const { token, expiresAt } = await createConnectSession({
      userId: session.user.id,
      email: session.user.email,
      displayName: session.user.name,
      providerConfigKey: getConnector(provider).providerConfigKey,
    });
    if (!token) throw new Error("No session token returned");
    return NextResponse.json({ token, expiresAt });
  } catch (err) {
    console.error("[pms/connect-session]", err?.message);
    return NextResponse.json({ error: "Could not start the connection flow" }, { status: 502 });
  }
}
