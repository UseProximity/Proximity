import Link from "next/link";
import Image from "next/image";

{
  /* ── Related guides — visible on mobile only (replaces aside) ── */
}
export default function RelatedArticlesMobile({ relatedGuides }) {
  return (
    <section className="mt-10 border-t border-gray-200 pt-8 lg:hidden">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
        Keep reading
      </p>
      <h3 className="mt-1 text-xl font-bold tracking-tight text-gray-950">
        Related articles
      </h3>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
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
            <div className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-500">
                {guide.category}
              </p>
              <h4 className="mt-1 text-xs font-semibold leading-5 text-gray-950 group-hover:text-rose-600 sm:text-sm sm:leading-6">
                {guide.title}
              </h4>
              <p className="mt-1 text-xs text-gray-500">{guide.readTime}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
