/*
 * POST /api/auth/restore-account: bring back an account deleted within the last
 * 30 days. Backs the confirm screen the sign-in form shows when sign-in answers
 * ACCOUNT_DELETED. See lib/auth/accountRestore.js for the whole flow.
 *
 * Body: { email, password } or { token } (the signed token Google sign-in puts
 * on the login URL), plus `confirm`. Without confirm it only reports when the
 * account was deleted and how long is left, which is what the screen shows;
 * with confirm: true it restores. The caller then signs in as normal.
 *
 * Every failure answers the same 401, whether the email is unknown, the
 * password wrong, the account not deleted or the window passed, so this can't
 * be used to learn which addresses had accounts.
 *
 * @auth public
 */
import { NextResponse } from "next/server";
import { normalizeEmail } from "@/lib/auth/email";
import {
  checkLoginLock,
  recordLoginFailure,
  recordLoginSuccess,
  clientIp,
} from "@/lib/auth/loginThrottle";
import {
  findRestorableByPassword,
  findRestorableById,
  verifyRestoreToken,
  restoreDeadline,
  restoreAccount,
} from "@/lib/auth/accountRestore";

const NOT_RESTORABLE = { error: "We couldn't restore that account. Sign in again to retry." };

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const confirm = body.confirm === true;
    let user = null;

    if (body.token) {
      user = await findRestorableById(verifyRestoreToken(body.token));
    } else {
      const email = normalizeEmail(body.email);
      if (!email || !body.password) {
        return NextResponse.json(NOT_RESTORABLE, { status: 401 });
      }
      // Same throttle as sign-in, so this is no side door for guessing passwords.
      const who = { email, ip: clientIp(req.headers) };
      if (checkLoginLock(who).locked) {
        return NextResponse.json(
          { error: "Too many failed sign-in attempts. Please wait about 15 minutes and try again." },
          { status: 429 }
        );
      }
      user = await findRestorableByPassword(email, body.password);
      if (!user) recordLoginFailure(who);
      else if (confirm) recordLoginSuccess(who);
    }

    if (!user || user.is_system) {
      return NextResponse.json(NOT_RESTORABLE, { status: 401 });
    }

    if (!confirm) {
      return NextResponse.json({
        deletedAt: user.deleted_at,
        restoreBy: restoreDeadline(user.deleted_at).toISOString(),
      });
    }

    const result = await restoreAccount(user);
    if (!result.ok) {
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, listingsRestored: result.listingsRestored });
  } catch (err) {
    console.error("[restore-account] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
