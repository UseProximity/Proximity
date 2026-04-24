import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export function getBaseUrl(req) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
}

export async function sendVerificationEmail({ email, name, token, baseUrl }) {
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;
  await transporter.sendMail({
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your Proximity account",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Welcome to Proximity${name ? `, ${name}` : ""}!</h2>
        <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
        <a href="${verifyUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Verify Email
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${verifyUrl}</p>
      </div>
    `,
  });
}
