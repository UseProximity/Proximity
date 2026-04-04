import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";

const FORMSPREE_URL =
  process.env.NEXT_PUBLIC_FORMSPREE_CONCIERGE_URL ||
  "https://formspree.io/f/xkoqolpy";

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
    const { error: responseError } = await supabase
      .from("matchmaking_responses")
      .insert({
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
      });

    if (responseError) {
      console.error("matchmaking: failed to insert response", responseError);
      return NextResponse.json(
        { error: "Failed to save response" },
        { status: 500 }
      );
    }

    // Also forward to Formspree so the original email notifications keep working
    fetch(FORMSPREE_URL, {
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
      }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    }).catch((err) => console.error("matchmaking: formspree forward failed", err));

    return NextResponse.json({ success: true, isNewUser });
  } catch (err) {
    console.error("matchmaking: unexpected error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
