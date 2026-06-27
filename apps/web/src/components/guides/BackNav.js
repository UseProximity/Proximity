import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackNav() {
  return (
    <section className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <Link
          href="/guides"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition hover:text-rose-600"
        >
          <ArrowLeft size={16} />
          Back to guides
        </Link>
      </div>
    </section>
  );
}
