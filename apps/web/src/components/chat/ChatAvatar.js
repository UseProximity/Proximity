"use client";

export default function ChatAvatar({ src, name, size = "md" }) {
  const sz = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  if (src && src !== "/images/default-profile.jpg") {
    return (
      <img
        src={src}
        alt={name || ""}
        className={`${sz} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  const initials = name ? name.charAt(0).toUpperCase() : "?";
  return (
    <div
      className={`${sz} rounded-full bg-red-100 text-red-600 font-semibold flex items-center justify-center flex-shrink-0`}
    >
      {initials}
    </div>
  );
}
