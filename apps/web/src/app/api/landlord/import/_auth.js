import { NextResponse } from "next/server";
import { auth } from "@/auth";

/* The signed-in landlord (or super) behind an import request, or a response. */
export async function requireImporter() {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!["landlord", "super"].includes(session.user.role)) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, userId: session.user.id, isSuper: session.user.role === "super" };
}

export function cronAuthorized(req) {
  const header = req.headers.get("authorization");
  return !!process.env.CRON_SECRET && header === `Bearer ${process.env.CRON_SECRET}`;
}
