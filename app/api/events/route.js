// DB migration (run manually in Supabase SQL editor):
// CREATE TABLE events (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id uuid REFERENCES users(id) ON DELETE SET NULL,
//   event_type text NOT NULL,
//   page text,
//   metadata jsonb,
//   created_at timestamptz DEFAULT now()
// );
// CREATE INDEX events_event_type_idx ON events(event_type);
// CREATE INDEX events_user_id_idx ON events(user_id);
// CREATE INDEX events_created_at_idx ON events(created_at);

import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";

export async function POST(request) {
  try {
    const body = await request.json();
    const { eventType, page, metadata, userId, sessionId } = body;
    if (!eventType) {
      return NextResponse.json({ error: "eventType required" }, { status: 400 });
    }

    await supabase.from("events").insert({
      user_id: userId ?? null,
      session_id: sessionId ?? null,
      event_type: eventType,
      page: page ?? null,
      metadata: metadata || {},
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("events: unexpected error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
