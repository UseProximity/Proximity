import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { calcAge } from "@/utils/listingFormatters";

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL SETUP INSTRUCTIONS
//
// This route sends an email from info@useproximity.org to the landlord's email
// when a prospective tenant submits the contact form on a listing page.
//
// You must set the following environment variables in your .env.local file:
//
//   EMAIL_HOST=...
//   EMAIL_PORT=587
//   EMAIL_USER=...
//   EMAIL_PASS=...
//
// ─── OPTION A: Gmail App Password ────────────────────────────────────────────
//
//   1. The sending account (info@useproximity.org) must have 2-Step Verification
//      enabled in Google Account settings.
//   2. Go to: Google Account → Security → App Passwords
//   3. Generate an app password for "Mail" / "Other (custom name)"
//   4. Set env vars:
//        EMAIL_HOST=smtp.gmail.com
//        EMAIL_PORT=587
//        EMAIL_USER=info@useproximity.org
//        EMAIL_PASS=<the 16-character app password>
//
// ─── OPTION B: SendGrid ──────────────────────────────────────────────────────
//
//   1. Sign up at sendgrid.com and verify your sending domain (useproximity.org)
//   2. Create an API key with "Mail Send" permissions
//   3. Set env vars:
//        EMAIL_HOST=smtp.sendgrid.net
//        EMAIL_PORT=587
//        EMAIL_USER=apikey
//        EMAIL_PASS=<your SendGrid API key>
//
// ─── OPTION C: Resend (recommended for Next.js) ──────────────────────────────
//
//   Alternatively, replace this entire route with the Resend SDK:
//     npm install resend
//   Then use:
//     import { Resend } from 'resend';
//     const resend = new Resend(process.env.RESEND_API_KEY);
//     await resend.emails.send({ from, to, subject, html });
//
// ─────────────────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false, // true for port 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      message,
      listingId,
      landlordEmail,
      landlordName,
      listingAddress,
    } = body;

    // Validate required fields
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !message?.trim() || !landlordEmail?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const senderName = `${firstName.trim()} ${lastName.trim()}`;

    const conversationsUrl = "https://useproximity.org/dashboard/landlord?view=conversations";
    const landlordMailOptions = {
      from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
      to: landlordEmail,
      replyTo: email,
      subject: `New message from ${senderName} — ${listingAddress || "your listing"}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
          <p>Hi ${landlordName || "there"},</p>

          <p><strong>${senderName}</strong> sent you a message about your listing at <strong>${listingAddress || "your property"}</strong>.</p>

          <div style="background: #f9fafb; border-left: 4px solid #dc2626; padding: 14px 16px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; white-space: pre-wrap; color: #374151; font-style: italic;">"${message.trim()}"</p>
          </div>

          <p style="margin-top: 24px;">
            <a href="${conversationsUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
              Reply in Proximity →
            </a>
          </p>

          <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
            You can also reply directly to this email — but replying through Proximity keeps all your conversations in one place.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            You're receiving this because your property is listed on Proximity.<br/>
            Questions? <a href="mailto:info@useproximity.org" style="color: #9ca3af;">info@useproximity.org</a>
          </p>
        </div>
      `,
    };

    const studentConfirmationOptions = {
      from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
      to: email,
      subject: `We got your message about ${listingAddress || "the listing"}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
          <p>Hi ${firstName.trim()},</p>

          <p>Thanks for reaching out! Your message about <strong>${listingAddress || "the listing"}</strong> has been received, and the landlord will be in touch with you shortly.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin-bottom: 8px; color: #6b7280;"><strong>Your message:</strong></p>
          <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${message.trim()}"</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            You're receiving this because you submitted an inquiry on Proximity. Questions? Contact us at
            <a href="mailto:info@useproximity.org" style="color: #9ca3af;">info@useproximity.org</a>
          </p>
        </div>
      `,
    };

    // Server-side 21+ age guard
    if (listingId) {
      const session = await auth();
      if (session?.user?.email) {
        const { data: listingRow } = await supabase
          .from("listings")
          .select("twenty_one_plus")
          .eq("id", listingId)
          .single();

        if (listingRow?.twenty_one_plus) {
          const { data: userRow } = await supabase
            .from("users")
            .select("birthday")
            .eq("email", session.user.email)
            .single();

          const age = calcAge(userRow?.birthday ?? null);
          if (age === null || age < 21) {
            return NextResponse.json({ error: "Age restriction: must be 21+" }, { status: 403 });
          }
        }
      }
    }

    // If email credentials are not configured, log and return success (dev mode)
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("[contactLandlord] Email env vars not set — skipping send in dev mode.");
      console.log("[contactLandlord] Would have sent:", { to: landlordEmail, from: senderName, subject: landlordMailOptions.subject });
      return NextResponse.json({ ok: true, dev: true });
    }

    const landlordInfo = await transporter.sendMail(landlordMailOptions);
    console.log(`[contactLandlord] Landlord email sent to ${landlordEmail} — messageId: ${landlordInfo.messageId}`);

    const studentInfo = await transporter.sendMail(studentConfirmationOptions);
    console.log(`[contactLandlord] Student confirmation sent to ${email} — messageId: ${studentInfo.messageId}`);

    // Record the contact as an active conversation and create a chat thread (fire-and-forget).
    if (listingId) {
      const session = await auth();
      const studentId = session?.user?.id;
      if (studentId) {
        try {
          // Upsert listing_active_conversations
          await supabase
            .from("listing_active_conversations")
            .upsert({
              listing_id: listingId,
              student_user_id: studentId,
              state: "inquired",
              last_activity_at: new Date().toISOString(),
            }, { onConflict: "listing_id,student_user_id", ignoreDuplicates: true });

          // Create a chat thread between student and landlord (if one doesn't exist)
          const { data: existing } = await supabase
            .from("chat_threads")
            .select("id")
            .eq("listing_id", listingId)
            .is("deleted_at", null)
            .limit(1)
            .maybeSingle();

          if (!existing) {
            const { data: typeRow } = await supabase
              .from("thread_types")
              .select("id")
              .eq("name", "listing_inquiry")
              .maybeSingle();

            const { data: thread } = await supabase
              .from("chat_threads")
              .insert({ listing_id: listingId, thread_type_id: typeRow?.id ?? null, subject: null })
              .select("id")
              .single();

            if (thread) {
              // Add student as participant
              await supabase.from("chat_participants").insert({ thread_id: thread.id, user_id: studentId });

              // Add primary landlord as participant
              const { data: ll } = await supabase
                .from("listing_landlords")
                .select("user_id")
                .eq("listing_id", listingId)
                .eq("is_primary", true)
                .maybeSingle();
              if (ll?.user_id && ll.user_id !== studentId) {
                await supabase.from("chat_participants").insert({ thread_id: thread.id, user_id: ll.user_id });
              }

              // Update conversation with the new thread id
              await supabase
                .from("listing_active_conversations")
                .update({ chat_thread_id: thread.id })
                .eq("listing_id", listingId)
                .eq("student_user_id", studentId);
            }
          }
        } catch (convErr) {
          console.error("[contactLandlord] conversation/thread creation failed:", convErr?.message);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/contactLandlord failed:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
