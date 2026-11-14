"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { createPortal } from "react-dom";
import { useFavorites } from "@/context/FavoritesContext";

function AuthModal({ onClose }) {
  // The modal is portalled to <body>, but React sends its events up the React
  // tree, to whatever renders the heart: a grid card would take a backdrop click
  // as its own and open the listing. Every click in the modal passes through the
  // backdrop, so it stops there.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center flex flex-col items-center gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <h2 className="text-gray-900 font-bold text-lg mb-1">Sign in to save this listing.</h2>
          <p className="text-gray-400 text-sm">Create a free account or sign in to continue.</p>
        </div>
        <button
          onClick={() => signIn("google", { callbackUrl: window.location.href })}
          className="flex items-center gap-3 bg-white border border-gray-200 shadow-sm hover:shadow-md text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition w-full justify-center"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Continue with Google
        </button>
      </div>
    </div>,
    document.body
  );
}

// The save control, the same everywhere: a white heart on a translucent dark
// circle, an outline when not saved and filled when saved. Callers only place it.
// The icon is a block (an inline svg leaves a text gap under it, which lifts the
// heart off the circle's center) nudged down half a pixel, where the heart's
// shape looks centered.
export default function HeartIcon({ listingId }) {
  const iconClass = "block h-5 w-5 translate-y-[0.5px]";
  const { data: session } = useSession();
  const { savedIds, setFavorite } = useFavorites();
  const isFavorite = savedIds.includes(String(listingId));
  const [showModal, setShowModal] = useState(false);

  // The heart changes at once and can be clicked again straight away; the
  // server is brought in line in the background (see FavoritesContext).
  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session?.user?.id) {
      setShowModal(true);
      return;
    }

    setFavorite(listingId, !isFavorite);
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="block rounded-full bg-black/30 p-[5px] text-white transition-colors focus:outline-none"
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={isFavorite}
      >
        {isFavorite ? (
          <svg xmlns="http://www.w3.org/2000/svg" fill="white" viewBox="0 0 24 24" className={iconClass}>
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className={iconClass}>
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        )}
      </button>
      {showModal && <AuthModal onClose={() => setShowModal(false)} />}
    </>
  );
}
