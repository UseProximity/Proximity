"use client";
import React, { useState } from "react";
import Image from "next/image";
import Modal from "./Modal";

export default function TourRequestModal({
  isOpen,
  onClose,
  onConfirm,
  listing,
}) {
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedTime, setSelectedTime] = useState("11:00 am");
  const [currentWeekStart, setCurrentWeekStart] = useState(new Date());

  // Get current date for displaying week
  const getWeekDates = (startDate) => {
    const dates = [];
    const date = new Date(startDate);
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }
    return dates;
  };

  const weekDates = getWeekDates(currentWeekStart);

  const formatDate = (date) => {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return {
      day: days[date.getDay()],
      month: months[date.getMonth()],
      date: date.getDate(),
    };
  };

  const isDateSelected = (date) => {
    return selectedDates.some(
      (selected) => selected.toDateString() === date.toDateString()
    );
  };

  const toggleDate = (date) => {
    if (selectedDates.length >= 3 && !isDateSelected(date)) return;

    if (isDateSelected(date)) {
      setSelectedDates(
        selectedDates.filter(
          (selected) => selected.toDateString() !== date.toDateString()
        )
      );
    } else {
      setSelectedDates([...selectedDates, date]);
    }
  };

  const goToPreviousWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentWeekStart(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentWeekStart(newDate);
  };

  const handleNext = () => {
    if (selectedDates.length > 0) {
      onConfirm({
        dates: selectedDates,
        time: selectedTime,
        listing: listing,
      });
    }
  };

  const timeOptions = [
    "9:00 am",
    "9:30 am",
    "10:00 am",
    "10:30 am",
    "11:00 am",
    "11:30 am",
    "12:00 pm",
    "12:30 pm",
    "1:00 pm",
    "1:30 pm",
    "2:00 pm",
    "2:30 pm",
    "3:00 pm",
    "3:30 pm",
    "4:00 pm",
    "4:30 pm",
    "5:00 pm",
    "5:30 pm",
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-lg">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Request a tour
        </h2>

        {/* Property Image and Details */}
        <div className="flex items-center space-x-4 mb-6">
          <div className="w-20 h-20 bg-gray-200 rounded-lg overflow-hidden">
            <Image
              src={listing?.images?.[0] || "/images/beaumont.jpg"}
              alt="Property"
              width={80}
              height={80}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {listing?.address || "Property Address"}
            </h3>
            <p className="text-gray-600">
              {listing?.city || "City"}, {listing?.state || "State"}{" "}
              {listing?.zipCode || "ZIP"}
            </p>
            <p className="text-gray-600">
              {listing?.bedrooms || 2} bd | {listing?.bathrooms || 1} ba |{" "}
              {listing?.sqft || 864} sqft
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="flex items-start space-x-3 mb-6 p-4 bg-blue-50 rounded-lg">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
            <svg
              className="w-4 h-4 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-700">
            Go on a personalized tour of this home by connecting with a local
            buyer&apos;s agent
          </p>
        </div>

        {/* Date Selection */}
        <div className="mb-6">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">
            Select up to 3 times
          </h4>

          {/* Week Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={goToPreviousWeek}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <div className="flex space-x-2">
              {weekDates.slice(0, 3).map((date, index) => {
                const formatted = formatDate(date);
                const isSelected = isDateSelected(date);
                return (
                  <button
                    key={index}
                    onClick={() => toggleDate(date)}
                    className={`p-4 rounded-lg border-2 transition-colors ${
                      isSelected
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    } ${
                      selectedDates.length >= 3 && !isSelected
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                    disabled={selectedDates.length >= 3 && !isSelected}
                  >
                    <div className="text-center">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatted.day}
                      </div>
                      <div className="text-lg font-bold text-gray-900">
                        {formatted.month} {formatted.date}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={goToNextWeek}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Time Selection */}
        <div className="mb-6">
          <select
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </div>

        {/* Add Time Button */}
        <button className="flex items-center space-x-2 text-blue-600 hover:text-blue-700 mb-6">
          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
          </div>
          <span className="font-semibold">Add a time</span>
        </button>

        {/* Next Button */}
        <button
          onClick={handleNext}
          disabled={selectedDates.length === 0}
          className={`w-full py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
            selectedDates.length > 0
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-300 cursor-not-allowed"
          }`}
        >
          Next
        </button>
      </div>
    </Modal>
  );
}
