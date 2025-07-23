"use client";
import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Bed,
  Bath,
  MapPin,
  Heart,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function PopularListings() {
  return (
    <section
      className="w-full py-16"
      style={{
        backgroundColor: "#fcfcfc",
        backgroundImage:
          "linear-gradient(to right, rgba(0,0,0,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.09) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    >
      <div className="mx-auto max-w-7xl px-4">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Popular Around WashU
          </h2>
          <p className="text-gray-600">
            No properties available yet. Be the first to add a listing!
          </p>
        </div>
      </div>
    </section>
  );
}
