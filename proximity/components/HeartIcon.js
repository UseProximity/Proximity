"use client";
import { useFavorites } from "@/context/FavoritesContext";
import { useUser } from "@/context/UserContext";

export default function HeartIcon({
  listingId,
  className = "h-6 w-6",
  showForAllRoles = false,
}) {
  const { toggleFavorite, isFavorited, isLoading } = useFavorites();
  const { role } = useUser();

  // Show for all users, but only make functional for students
  const isStudent = role === "student";

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isStudent) {
      toggleFavorite(listingId);
    }
  };

  const isFavorite = isStudent ? isFavorited(listingId) : false;

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`z-20 relative ${
        isStudent ? "cursor-pointer hover:scale-110" : "cursor-default"
      } transition-transform ${isLoading ? "opacity-50" : ""} p-1`}
      title={
        isStudent
          ? isFavorite
            ? "Remove from favorites"
            : "Add to favorites"
          : ""
      }
      style={{ pointerEvents: "auto" }}
    >
      {isFavorite ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`${className} text-red-500`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`${className} ${
            role === "student"
              ? "text-gray-400 hover:text-red-500"
              : "text-gray-300"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 000-6.364 4.5 4.5 0 00-6.364 0L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      )}
    </button>
  );
}
