/*
 * Finish the profile of an account created by a signed-out review.
 *
 * @auth public
 *
 * Public by necessity: the whole point is that the account has no way to log in
 * yet. Authorization is the profile-setup token issued when the review was
 * posted (lib/reviews/onboarding.js), which:
 *   - only ever exists for an account with NO password, Google or Apple login,
 *     so it can never be used to edit a real user's profile;
 *   - expires after a week and is burned on use;
 *   - grants exactly these fields and nothing else. Notably NOT email (that
 *     would let someone repoint the account) and NOT a privileged role.
 *
 * This is the ONLY place profile_complete becomes true for these accounts. It
 * requires a POST from a human pressing Save. A review submission alone never
 * marks a profile finished.
 *
 * GET  ?token=… → the values the form should open pre-filled with (used by the
 *                 inline step after a refresh, and by /review/finish).
 * POST           → apply the profile and mark it complete.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";
import { loadProfileSetupUser, clearProfileSetupToken } from "@/lib/reviews/onboarding";
import { GENDERS, REFERRAL_SOURCES } from "@/components/auth/profileFields";

export const dynamic = "force-dynamic";

// A student self-completing a profile may only ever be one of these. admin,
// super and system are assignable exclusively by an admin, server-side.
const SELF_ASSIGNABLE_ROLES = new Set(["student", "landlord", "parent", "other"]);

export async function GET(req) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    const found = await loadProfileSetupUser(token);
    if (!found) {
      return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
    }
    return NextResponse.json({ prefill: found.prefill });
  } catch (e) {
    console.error("GET /api/profile/complete-from-review failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      token,
      firstName,
      lastName,
      role,
      gender,
      referralSource,
      graduationYear,
      graduationMonth,
    } = body;

    const found = await loadProfileSetupUser(token);
    if (!found) {
      return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
    }

    const first = String(firstName || "").trim();
    const last = String(lastName || "").trim();
    if (!first || !last) {
      return NextResponse.json({ error: "Enter your first and last name." }, { status: 400 });
    }

    const roleName = String(role || "").toLowerCase();
    if (!SELF_ASSIGNABLE_ROLES.has(roleName)) {
      return NextResponse.json({ error: "Select who you are." }, { status: 400 });
    }
    if (!GENDERS.includes(gender)) {
      return NextResponse.json({ error: "Select your gender." }, { status: 400 });
    }
    if (!REFERRAL_SOURCES.includes(referralSource)) {
      return NextResponse.json({ error: "Tell us how you found us." }, { status: 400 });
    }

    // Graduation is required of students and meaningless for everyone else.
    const isStudent = roleName === "student";
    let gradYear = null;
    let gradMonth = null;
    if (isStudent) {
      gradYear = Number.parseInt(graduationYear, 10);
      gradMonth = Number.parseInt(graduationMonth, 10);
      const thisYear = new Date().getFullYear();
      const yearOk = Number.isInteger(gradYear) && gradYear >= thisYear - 12 && gradYear <= thisYear + 10;
      const monthOk = Number.isInteger(gradMonth) && gradMonth >= 1 && gradMonth <= 12;
      if (!yearOk || !monthOk) {
        return NextResponse.json({ error: "Select your expected graduation." }, { status: 400 });
      }
    }

    const { data: roleRow } = await supabase
      .from("roles")
      .select("id")
      .eq("name", roleName)
      .maybeSingle();
    if (!roleRow?.id) {
      return NextResponse.json({ error: "Select who you are." }, { status: 400 });
    }

    const { error } = await updateAsUser(supabase, {
      userId: found.userId,
      table: "users",
      data: {
        name: `${first} ${last}`,
        role_id: roleRow.id,
        gender,
        referral_source: referralSource,
        graduation_year: gradYear,
        graduation_month: gradMonth,
        profile_complete: true,
      },
      rowId: found.userId,
    });

    if (error) {
      console.error("complete-from-review: update failed:", error);
      return NextResponse.json({ error: "Couldn't save your profile." }, { status: 500 });
    }

    await clearProfileSetupToken(found.userId);

    return NextResponse.json({ ok: true, role: roleName });
  } catch (e) {
    console.error("POST /api/profile/complete-from-review failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
