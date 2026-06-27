"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";

const TRANSITION_MS = 700;
const EASING = "cubic-bezier(0.25, 0, 0.15, 1)";

// Pure helper — no closure issues
function toReal(ci, count) {
  return ((ci % count) + count) % count;
}

export default function GuidesCarousel({ guides = [] }) {
  if (!guides.length) return null;
  if (guides.length === 1) {
    return (
      <div className="mx-auto w-full max-w-xl px-4">
        <ActiveCard guide={guides[0]} />
      </div>
    );
  }
  return <Carousel key={guides.map((g) => g.slug).join(",")} guides={guides} />;
}

function Carousel({ guides }) {
  const count = guides.length;
  const OFFSET = count;
  const cloned = [...guides, ...guides, ...guides];

  const [cloneIdx, setCloneIdx] = useState(OFFSET);
  const [activeReal, setActiveReal] = useState(0);
  const [animated, setAnimated] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  // All mutable state that callbacks need lives in refs — zero stale closures
  const busyRef = useRef(false);
  const idxRef = useRef(OFFSET); // always mirrors cloneIdx
  const countRef = useRef(count); // always mirrors count
  const offsetRef = useRef(OFFSET); // always mirrors OFFSET
  const timerRef = useRef(null);

  // Keep refs in sync with props/state
  countRef.current = count;
  offsetRef.current = OFFSET;

  // Core navigation — reads everything from refs, no stale values possible
  function goTo(target) {
    if (busyRef.current) return;
    busyRef.current = true;

    const c = countRef.current;
    const o = offsetRef.current;

    idxRef.current = target;
    setCloneIdx(target);
    setActiveReal(toReal(target, c));
    setAnimated(true);
    setTransitioning(true);

    timerRef.current = setTimeout(() => {
      const real = toReal(target, c);
      const mid = real + o;
      idxRef.current = mid;
      setAnimated(false);
      setCloneIdx(mid);

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnimated(true);
          setTransitioning(false);
          busyRef.current = false;
        })
      );
    }, TRANSITION_MS + 60);
  }

  function prev() {
    goTo(idxRef.current - 1);
  }
  function next() {
    goTo(idxRef.current + 1);
  }
  function goToReal(ri) {
    const c = countRef.current;
    const cur = toReal(idxRef.current, c);
    let d = ri - cur;
    if (d > c / 2) d -= c;
    if (d < -c / 2) d += c;
    if (d !== 0) goTo(idxRef.current + d);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Swipe
  const touchX = useRef(null);
  function onTouchStart(e) {
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
  }

  return (
    <div
      className="gc relative w-full overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        .gc {
          --gc-active: 74%;
          --gc-side:   11%;
          --gc-step:   44%;
        }
        @media (min-width: 768px) {
          .gc {
            --gc-active: 60%;
            --gc-side:   18%;
            --gc-step:   40%;
          }
        }
      `}</style>

      {/* Height anchor */}
      <div
        className="invisible pointer-events-none mx-auto"
        style={{ width: "var(--gc-active)" }}
        aria-hidden
      >
        <ActiveCard guide={guides[0]} />
      </div>

      {/* Single sliding strip — pointer-events-none so it never blocks controls */}
      <div
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
        style={{
          transform: `translateX(calc(50% - ${cloneIdx} * var(--gc-step)))`,
          transition: animated
            ? `transform ${TRANSITION_MS}ms ${EASING}`
            : "none",
          willChange: "transform",
        }}
      >
        {cloned.map((guide, i) => {
          const offset = i - cloneIdx;
          const abs = Math.abs(offset);
          const isActive = offset === 0;
          const opacity = isActive ? 1 : abs === 1 ? 0.45 : 0;
          const scale = isActive ? 1 : 0.9;
          const zIndex = isActive ? 10 : abs === 1 ? 5 : 1;

          return (
            <div
              key={i}
              className="absolute top-0"
              style={{
                left: `calc(${i} * var(--gc-step))`,
                width: isActive ? "var(--gc-active)" : "var(--gc-side)",
                transform: `translateX(-50%) scale(${scale})`,
                transformOrigin: "top center",
                opacity,
                zIndex,
                transition: animated
                  ? `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ${EASING}, width ${TRANSITION_MS}ms ${EASING}`
                  : "none",
                pointerEvents: abs <= 1 ? "auto" : "none",
                cursor: abs === 1 ? "pointer" : "default",
              }}
              onClick={
                !isActive && abs === 1
                  ? () => goTo(idxRef.current + offset)
                  : undefined
              }
            >
              {isActive ? (
                <ActiveCard guide={guide} showText={!transitioning} />
              ) : (
                <SideCard guide={guide} />
              )}
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-8 flex items-center justify-center gap-5">
        <NavBtn onClick={prev} dir="left" label="Previous guide" />
        <div className="flex items-center gap-2">
          {guides.map((_, i) => (
            <button
              key={i}
              onClick={() => goToReal(i)}
              aria-label={`Guide ${i + 1}`}
              className={[
                "rounded-full transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-rose-500",
                i === activeReal
                  ? "h-2.5 w-6 bg-rose-500"
                  : "h-2.5 w-2.5 bg-gray-300 hover:bg-gray-400",
              ].join(" ")}
            />
          ))}
        </div>
        <NavBtn onClick={next} dir="right" label="Next guide" />
      </div>
    </div>
  );
}

function NavBtn({ onClick, dir, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
    >
      {dir === "left" ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
    </button>
  );
}

function ActiveCard({ guide, showText = true }) {
  return (
    <Link href={`/guides/${guide.slug}`} className="group block">
      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg transition duration-200 hover:shadow-xl">
        <div className="relative h-52 w-full overflow-hidden sm:h-64 lg:h-72">
          <Image
            src={guide.image}
            alt={guide.title}
            fill
            className="object-cover transition duration-300 group-hover:scale-[1.04]"
            priority
          />
        </div>
        <div
          className="flex h-44 flex-col justify-between p-5 sm:p-6"
          style={{
            opacity: showText ? 1 : 0,
            transition: showText ? "opacity 200ms ease" : "none",
          }}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 font-semibold uppercase tracking-[0.15em] text-rose-600">
                {guide.category}
              </span>
              <span className="flex items-center gap-1 text-gray-500">
                <Clock3 size={12} />
                {guide.readTime}
              </span>
            </div>
            <h3 className="mt-2.5 line-clamp-2 text-lg font-bold leading-snug tracking-tight text-gray-950 transition group-hover:text-rose-600 sm:text-xl">
              {guide.title}
            </h3>
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate text-xs text-gray-500 sm:text-sm">
              {guide.author}
            </span>
            <span className="ml-4 inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-rose-600 transition group-hover:text-rose-700">
              Read article <ArrowRight size={14} />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function SideCard({ guide }) {
  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="relative h-52 w-full overflow-hidden sm:h-64 lg:h-72">
        <Image
          src={guide.image}
          alt={guide.title}
          fill
          className="object-cover"
        />
      </div>
      <div className="flex h-44 items-start p-4 sm:p-5">
        <p className="hidden line-clamp-3 text-xs font-semibold leading-5 text-gray-800 sm:block sm:text-sm">
          {guide.title}
        </p>
      </div>
    </article>
  );
}
