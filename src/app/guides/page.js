"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import Footer from "@/components/layout/Footer";

import { Hourglass } from "lucide-react";

const guides = [
  {
    title: "Crafting the Perfect Housing Application",
    description:
      "Learn how to create a standout housing application that captures the attention of landlords.",
    image: "https://images.pexels.com/photos/358636/pexels-photo-358636.jpeg",
    date: "May 12, 2026",
    readTime: "4 min",
    category: "Applications",
    link: "/guides/application",
  },
  {
    title: "Acing Your Housing Interview",
    description:
      "Discover expert tips and strategies to excel in your housing interview.",
    image: "https://images.pexels.com/photos/6585012/pexels-photo-6585012.jpeg",
    date: "May 8, 2026",
    readTime: "6 min",
    category: "Interviews",
    link: "/guides/interview",
  },
  {
    title: "Navigating the Housing Market",
    description:
      "Get insider knowledge on how to navigate the competitive housing market.",
    image:
      "https://images.pexels.com/photos/20208884/pexels-photo-20208884.jpeg",
    date: "May 4, 2026",
    readTime: "5 min",
    category: "Housing Search",
    link: "/guides/market",
  },
];

const faqs = [
  {
    question: "How can I make my housing application stand out?",
    answer:
      "Focus on creating a complete and professional profile. Include accurate personal information, references where possible, and tailor your application to the specific property you're interested in.",
  },
  {
    question: "What should I expect during a housing interview?",
    answer:
      "Landlords often ask about your studies, income, rental history, and lifestyle. Be honest, polite, and prepared to explain why you'd be a reliable tenant.",
  },
  {
    question: "When should I start looking for student housing?",
    answer:
      "It's best to begin your search several weeks or months before your intended move-in date, especially during busy academic periods when demand is highest.",
  },
  {
    question: "How do I avoid rental scams?",
    answer:
      "Always verify the property and landlord before sending money. Be cautious of listings with prices that seem too good to be true and avoid sharing sensitive information unnecessarily.",
  },
  {
    question: "Can international students apply for housing?",
    answer:
      "Yes. Many landlords welcome international students, although some may request additional documents such as proof of enrolment or financial support.",
  },
];

export default function GuidesPage() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <main className="min-h-screen bg-white">
      {/* ── Hero ── */}
      <section className="bg-gradient-to-br from-red-50 to-white px-6 py-20 text-center">
        <p className="text-red-500 font-semibold text-sm uppercase tracking-widest mb-3">
          Guides
        </p>
        <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight text-gray-900 mb-6">
          Your Ultimate Housing Search Companion
        </h1>
        <p className="text-gray-500 text-lg max-w-xl mx-auto">
          Our comprehensive guides cover everything from crafting the perfect
          application to acing your housing interview. With expert tips and
          insider knowledge, we empower you to navigate the housing search with
          confidence and secure your ideal home.
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-10">
          {[
            "Applications",
            "Interviews",
            "Housing Search",
            "Renting Tips",
            "Student Life",
          ].map((category) => (
            <button
              key={category}
              className="px-4 py-2 rounded-full border border-gray-200 text-sm font-medium text-gray-600 hover:border-red-500 hover:text-red-500 transition"
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      {/* ── Guide Cards ── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="border-t border-gray-200">
          {guides.map((guide) => (
            <Link key={guide.title} href={guide.link} className="group">
              <article className="grid md:grid-cols-[1fr_280px] gap-8 py-10 border-b border-gray-200">
                <div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                    <span>{guide.category}</span>

                    <span>•</span>

                    <span>Published {guide.date}</span>

                    <span>•</span>

                    <span className="flex items-center gap-1">
                      <Hourglass size={14} strokeWidth={1.75} />
                      {guide.readTime}
                    </span>
                  </div>

                  <h2 className="text-3xl font-bold text-gray-900 group-hover:text-gray-500 group-hover:underline transition-colors duration-200 mb-4">
                    {guide.title}
                  </h2>

                  <p className="text-gray-600 text-lg leading-relaxed max-w-2xl">
                    {guide.description}
                  </p>
                </div>

                <div className="relative h-44 md:h-40 overflow-hidden">
                  <Image
                    src={guide.image}
                    alt={guide.title}
                    fill
                    className="object-cover"
                  />
                </div>
              </article>
            </Link>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-gray-50 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-red-500 font-semibold text-sm uppercase tracking-widest mb-3">
              FAQ
            </p>

            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Frequently Asked Questions
            </h2>

            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Find answers to common questions about student housing,
              applications, interviews, and the rental process.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;

              return (
                <div
                  key={faq.question}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden"
                >
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-semibold text-gray-900 text-lg">
                      {faq.question}
                    </span>

                    <span
                      className={`text-2xl transition-transform duration-300 ${
                        isOpen ? "rotate-45" : ""
                      }`}
                    >
                      +
                    </span>
                  </button>

                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      isOpen
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="px-6 pb-5 text-gray-600 leading-relaxed">
                        {faq.answer}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
