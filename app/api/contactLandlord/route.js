import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

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

    const landlordMailOptions = {
      from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
      to: landlordEmail,
      replyTo: email,
      subject: `New Inquiry: ${listingAddress || "Your Listing"} — via Proximity`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
          <p>Hi ${landlordName || "there"},</p>

          <p>You've received a new inquiry about your listing at <strong>${listingAddress || "your property"}</strong> through Proximity.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin: 6px 0;"><strong>From:</strong> ${senderName}</p>
          <p style="margin: 6px 0;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #dc2626;">${email}</a></p>
          <p style="margin: 6px 0;"><strong>Phone:</strong> ${phone?.trim() || "Not provided"}</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin-bottom: 8px;"><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${message.trim()}"</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p>You can reply directly to this email to respond to ${firstName.trim()}. Quick responses help students make confident decisions, and responsive landlords tend to get the best tenants.</p>

          <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            You're receiving this because your property is listed on Proximity. Questions? Contact us at
            <a href="mailto:info@useproximity.org" style="color: #9ca3af;">info@useproximity.org</a>
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

    // If email credentials are not configured, log and return success (dev mode)
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("[contactLandlord] Email env vars not set — skipping send in dev mode.");
      console.log("[contactLandlord] Would have sent:", { to: landlordEmail, from: senderName, subject: landlordMailOptions.subject });
      return NextResponse.json({ ok: true, dev: true });
    }

    await transporter.sendMail(landlordMailOptions);
    await transporter.sendMail(studentConfirmationOptions);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/contactLandlord failed:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
