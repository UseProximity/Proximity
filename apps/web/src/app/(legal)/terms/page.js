import { getLegalDoc } from "@/lib/legal";
import LegalPage from "../LegalPage";

const doc = getLegalDoc("terms");

export const metadata = {
  title: `${doc.title} | Proximity`,
  description: doc.description,
  alternates: { canonical: "/terms" },
};

export default function TermsOfServicePage() {
  return <LegalPage doc={doc} />;
}
