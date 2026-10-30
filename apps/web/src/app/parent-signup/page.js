/*
 * /parent-signup: parents leave an email and get the WashU parent housing guide
 * in their inbox. The form posts to /api/parent-signup, which saves them as a
 * `parent` user and sends the email.
 */
import ParentSignupClient from "./ParentSignupClient";

export const metadata = {
  title: "Free WashU Housing Guide for Parents | Proximity",
  description:
    "Get the WashU parent housing guide in your inbox: dorm rules, what off-campus really costs, and what families should know before their student signs a lease.",
};

export default function ParentSignupPage() {
  return <ParentSignupClient />;
}
