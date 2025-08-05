import Link from "next/link";
import Image from "next/image";
import { Instagram } from "lucide-react";
import Logo from "@/public/logo.png";

export default function Footer() {
  return (
    <>
      <footer
        className="w-full bg-gray-900 text-white relative overflow-hidden"
        style={{
          width: "100vw",
          marginLeft: "calc(-50vw + 50%)",
          backgroundColor: "#111827",
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 0",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 opacity-80" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-20">
          <div className="flex flex-col items-center gap-6 md:gap-8">
            {/* Logo and Title */}
            <div className="flex flex-col items-center space-y-4">
              <div className="flex flex-row items-center">
                <Image
                  src={Logo}
                  alt="Proximity Logo"
                  width={56}
                  height={56}
                  className="object-contain"
                />
                <h2 className="text-2xl md:text-3xl font-bold text-white">
                  Proximity
                </h2>
              </div>
              <p className="text-lg md:text-xl text-gray-200 leading-relaxed max-w-md text-center font-medium">
                Find Student Housing Without the Hassle
              </p>
            </div>

            {/* Social Media Links */}
            <div className="flex items-center justify-center space-x-4 md:space-x-6">
              <Link
                href="https://www.instagram.com/useproximity"
                className="text-gray-400 hover:text-white transition-colors duration-300 transform hover:scale-110"
                aria-label="Instagram"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Instagram className="h-6 w-6 md:h-7 md:w-7" />
              </Link>

              <Link
                href="https://www.tiktok.com/@useproximity"
                className="text-gray-400 hover:text-white transition-colors duration-300 transform hover:scale-110"
                aria-label="TikTok"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  className="h-6 w-6 md:h-7 md:w-7"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Footer Bottom */}
          <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-gray-700">
            <div className="text-center">
              <p className="text-gray-300 text-sm font-medium">
                © 2025 Proximity. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
