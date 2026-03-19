"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";

export default function HeartIcon({ session, listingId, initial = false }) {
  const [isFavorite, setIsFavorite] = useState(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setIsFavorite(initial);
  }, [initial]);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    if (!session) {
      signIn(undefined, { callbackUrl: "/browse" });
    }

    const prev = isFavorite;
    const next = !prev;

    setIsFavorite(next);
    setPending(true);

    try {
      if (!session?.user?.id) {
        setIsFavorite(prev);
        return;
      }

      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, userId: session?.user?.id }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || typeof data.favorited !== "boolean") {
        setIsFavorite(prev);
        return;
      }

      setIsFavorite(data.favorited);
    } catch (err) {
      console.error("Could not update favorites:", err);
      setIsFavorite(prev);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      className="focus:outline-none p-1.5 hover:text-red-500 transition-all disabled:opacity-60"
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorite}
    >
      {isFavorite ? (
        <svg xmlns="http://www.w3.org/2000/svg" fill="red" viewBox="0 0 24 24" className="h-6 w-6">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="h-6 w-6">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
    </button>
  );
}
