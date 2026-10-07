import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/auth";
import { isProdData } from "@/lib/appEnv";

// Short-lived Supabase-shaped JWT for Realtime only. Writes/history stay on /api/chat/*.
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function getJwtSecret() {
  const secret = isProdData()
    ? process.env.PROD_SUPABASE_JWT_SECRET
    : process.env.DEV_SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      `Missing ${isProdData() ? "PROD" : "DEV"}_SUPABASE_JWT_SECRET env var`
    );
  }
  return secret;
}

// GET /api/chat/realtime-token — mint a Realtime JWT for the logged-in user
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = new TextEncoder().encode(getJwtSecret());
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

    const accessToken = await new SignJWT({
      role: "authenticated",
      aud: "authenticated",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(session.user.id)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(secret);

    return NextResponse.json({ accessToken, expiresAt });
  } catch (error) {
    console.error("GET /api/chat/realtime-token failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
