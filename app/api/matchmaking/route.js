// DB migration (run manually in Supabase SQL editor):
// ALTER TABLE matchmaking_responses
//   ADD COLUMN move_in_date_earliest date,
//   ADD COLUMN move_in_date_latest date;

import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";

const FORMSPREE_URL =
  process.env.NEXT_PUBLIC_FORMSPREE_CONCIERGE_URL ||
  "https://formspree.io/f/xkoqolpy";

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

    const { data: response } = await supabase
      .from("matchmaking_responses")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({ hasResponse: !!response, response: response || null });
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
      name, email, year_of_school, group_size, budget, lease_term,
      furnished, commute, medical_campus, priorities, student_type,
      area, notes, move_in_date_earliest, move_in_date_latest,
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
      .from("matchmaking_responses")
      .update(updatePayload)
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
      year_of_school,
      group_size,
      budget,
      lease_term,
      furnished,
      commute,
      medical_campus,
      priorities,
      student_type,
      area,
      notes,
      referral_source,
      move_in_date_earliest,
      move_in_date_latest,
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
      // Create a stub user with incomplete profile
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email: normalizedEmail,
          name: name.trim(),
          role: "student",
          profile_complete: false,
          gender: "unspecified",
          phone: "N/A",
          description: "",
          referral_source: referral_source || "",
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

    // Save the matchmaking response linked to the user
    const insertPayload = {
      user_id: userId,
      name: name.trim(),
      email: normalizedEmail,
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
      referral_source: referral_source || null,
    };
    // Only include move_in_date columns if they were sent — they require a DB migration
    // (ALTER TABLE matchmaking_responses ADD COLUMN move_in_date_earliest date, ADD COLUMN move_in_date_latest date)
    // that may not yet be applied in all environments.
    if (move_in_date_earliest !== undefined) insertPayload.move_in_date_earliest = move_in_date_earliest || null;
    if (move_in_date_latest !== undefined) insertPayload.move_in_date_latest = move_in_date_latest || null;

    const { error: responseError } = await supabase
      .from("matchmaking_responses")
      .insert(insertPayload);

    if (responseError) {
      console.error("matchmaking: failed to insert response", responseError);
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
          year_of_school,
          group_size,
          budget,
          lease_term,
          furnished,
          commute,
          medical_campus,
          priorities,
          student_type,
          area,
          notes,
          referral_source,
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
