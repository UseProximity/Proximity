import Image from "next/image";
import Link from "next/link";

{
  /* ── Sidebar — desktop only ── */
}
export default function RelatedArticlesSidebar({ relatedGuides }) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-36">
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-500">
              Keep reading
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-gray-950">
              Related articles
            </h3>
          </div>

          <div className="space-y-4 p-4">
            {relatedGuides.slice(0, 2).map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className="group block overflow-hidden rounded-2xl border border-gray-200 transition hover:border-rose-200 hover:shadow-md"
              >
                <div className="relative aspect-[16/9]">
                  <Image
                    src={guide.image}
                    alt={guide.title}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">
                    {guide.category}
                  </p>
                  <h4 className="mt-2 font-semibold leading-6 text-gray-950 group-hover:text-rose-600">
                    {guide.title}
                  </h4>
                  <p className="mt-2 text-sm text-gray-500">{guide.readTime}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
