"use client";

/**
 * Thumbnail for a conversation. shape="square" is used for listing cover photos
 * (a property reads better as a rounded square than a circle); people stay round.
 */
export default function ChatAvatar({ src, name, size = "md", shape = "circle" }) {
  const sz = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  const radius = shape === "square" ? "rounded-lg" : "rounded-full";
  if (src && src !== "/images/default-profile.jpg") {
    return (
      <img
        src={src}
        alt={name || ""}
        className={`${sz} ${radius} object-cover flex-shrink-0`}
      />
    );
  }
  const initials = name ? name.charAt(0).toUpperCase() : "?";
  return (
    <div
      className={`${sz} ${radius} bg-red-100 text-red-600 font-semibold flex items-center justify-center flex-shrink-0`}
    >
      {initials}
    </div>
  );
}
