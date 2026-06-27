import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";

const FORMSPREE_URL =
  process.env.NEXT_PUBLIC_FORMSPREE_CONCIERGE_URL ||
  "https://formspree.io/f/xkoqolpy";

// Parse a budget string like "$800-$1,000" or "$1,500" into a numeric value
function parseBudgetNum(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const stripped = String(value).replace(/[$,\s]/g, "");
  const range = stripped.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (range) return Number(range[2]);
  const single = stripped.match(/^(\d+(?:\.\d+)?)$/);
  if (single) return Number(single[1]);
  return null;
}

function parseBudgetMin(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const stripped = String(value).replace(/[$,\s]/g, "");
  const range = stripped.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (range) return Number(range[1]);
  const single = stripped.match(/^(\d+(?:\.\d+)?)$/);
  if (single) return Number(single[1]);
  return null;
}

// Convert furnished field from various text representations to boolean
function parseFurnished(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["yes", "true", "furnished"].includes(value.toLowerCase());
  }
  return null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ hasResponse: false });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", session.user.email.toLowerCase())
      .single();

    if (!user) {
      return NextResponse.json({ hasResponse: false });
    }

    const { data: pref } = await supabase
      .from("matchmaking_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({ hasResponse: !!pref, response: pref || null });
  } catch {
    return NextResponse.json({ hasResponse: false, response: null });
  }
}

export async function PATCH(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name, email,
      group_size, budget, lease_term,
      furnished, student_type,
      area, notes, move_in_date_earliest, move_in_date_latest,
      move_out_date, open_to_roommates,
      budget_min,
    } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", session.user.email.toLowerCase())
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updatePayload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      year_of_school: year_of_school || null,
      group_size: group_size || null,
      budget: budget || null,
      lease_term: lease_term || null,
      furnished: furnished || null,
      commute: commute || null,
      medical_campus: medical_campus ?? false,
      priorities: priorities || [],
      student_type: student_type || null,
      area: area || null,
      notes: notes || null,
    };
    if (move_in_date_earliest !== undefined) updatePayload.move_in_date_earliest = move_in_date_earliest || null;
    if (move_in_date_latest !== undefined) updatePayload.move_in_date_latest = move_in_date_latest || null;

    const { error } = await supabase
      .from("matchmaking_preferences")
      .update({
        budget_min: parseBudgetMin(budget_min ?? budget) ?? null,
        budget_max: parseBudgetNum(budget) ?? null,
        group_size: group_size ?? null,
        lease_term: lease_term ?? null,
        furnished: parseFurnished(furnished),
        student_type: student_type ?? null,
        area: area ?? null,
        notes: notes ?? null,
        move_in_date_earliest: move_in_date_earliest ?? null,
        move_in_date_latest: move_in_date_latest ?? null,
        move_out_date: move_out_date ?? null,
        open_to_roommates: open_to_roommates ?? null,
      })
      .eq("user_id", user.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("matchmaking PATCH: unexpected error", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      group_size,
      budget,
      budget_min,
      lease_term,
      furnished,
      student_type,
      area,
      notes,
      move_in_date_earliest,
      move_in_date_latest,
      move_out_date,
      open_to_roommates,
    } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find existing user by email
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, profile_complete")
      .eq("email", normalizedEmail)
      .single();

    let userId;
    let isNewUser = false;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Look up the student role ID
      const { data: studentRole } = await supabase
        .from("roles")
        .select("id")
        .eq("name", "student")
        .single();

      // Create a stub user with incomplete profile
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email: normalizedEmail,
          name: name.trim(),
          role_id: studentRole?.id ?? null,
          profile_complete: false,
          gender: "unspecified",
          phone: "N/A",
          description: "",
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("matchmaking: failed to create stub user", insertError);
        return NextResponse.json(
          { error: "Failed to process submission" },
          { status: 500 }
        );
      }

      userId = newUser.id;
      isNewUser = true;
    }

    // Upsert matchmaking_preferences (UNIQUE on user_id)
    const { error: prefError } = await supabase
      .from("matchmaking_preferences")
      .upsert({
        user_id: userId,
        budget_min: parseBudgetMin(budget_min ?? budget) ?? null,
        budget_max: parseBudgetNum(budget) ?? null,
        group_size: group_size ?? null,
        lease_term: lease_term ?? null,
        furnished: parseFurnished(furnished),
        student_type: student_type ?? null,
        area: area ?? null,
        notes: notes ?? null,
        move_in_date_earliest: move_in_date_earliest ?? null,
        move_in_date_latest: move_in_date_latest ?? null,
        move_out_date: move_out_date ?? null,
        open_to_roommates: open_to_roommates ?? null,
      }, { onConflict: "user_id" });

    if (prefError) {
      console.error("matchmaking: failed to upsert preferences", prefError);
      return NextResponse.json(
        { error: "Failed to save response" },
        { status: 500 }
      );
    }

    // Forward to Formspree for email notifications.
    // Awaited before returning so Vercel doesn't terminate the function early.
    try {
      await fetch(FORMSPREE_URL, {
        method: "POST",
        body: JSON.stringify({
          name,
          email: normalizedEmail,
          group_size,
          budget,
          lease_term,
          furnished,
          student_type,
          area,
          notes,
          move_in_date_earliest,
          move_in_date_latest,
        }),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch (err) {
      console.error("matchmaking: formspree forward failed", err);
    }

    return NextResponse.json({ success: true, isNewUser });
  } catch (err) {
    console.error("matchmaking: unexpected error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
