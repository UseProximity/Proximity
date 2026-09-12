/*
 * Shown while /compare loads its listings, so a student arriving from Browse
 * sees the stage taking shape instead of a blank page. The real cards then
 * animate in over it.
 */
export default function CompareLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading comparison">
      <div className="flex items-center justify-between">
        <span className="h-4 w-28 rounded-full bg-gray-100" />
        <span className="h-4 w-36 rounded-full bg-gray-100" />
      </div>
      <div className="mt-6 flex items-end justify-between">
        <span className="h-9 w-56 rounded-full bg-gray-100" />
        <span className="h-7 w-52 rounded-full bg-gray-100" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-[1fr_230px_1fr] md:gap-0 lg:grid-cols-[1fr_280px_1fr] xl:grid-cols-[1fr_320px_1fr]">
        {[0, 1].map((slot) => (
          <div key={slot} className={`animate-pulse ${slot === 1 ? "col-start-2 md:col-start-3" : ""}`}>
            <div className="aspect-[4/3] rounded-3xl bg-gray-100 md:aspect-[16/11]" />
            <div className="mt-6 h-6 w-3/4 rounded-full bg-gray-100" />
            <div className="mt-3 h-4 w-1/2 rounded-full bg-gray-100" />
            <div className="mt-6 h-9 w-2/5 rounded-full bg-gray-100" />
          </div>
        ))}
        <div className="col-start-2 row-start-1 hidden px-3 pt-6 md:block lg:px-4">
          <div className="h-[420px] rounded-2xl bg-gray-50 ring-1 ring-black/5" />
        </div>
      </div>
    </main>
  );
}
