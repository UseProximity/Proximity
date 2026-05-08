"use client";

const STEPS = [
  { n: 1, label: "Upload & analyse" },
  { n: 2, label: "Verify" },
  { n: 3, label: "Lease terms" },
  { n: 4, label: "Fees" },
  { n: 5, label: "Publish" },
];

export default function WizardProgress({ currentStep }) {
  return (
    <div className="w-full mb-8">
      {/* Mobile: just show "Step N of 8 — Label" */}
      <div className="sm:hidden text-sm text-gray-500 mb-1">
        Step {currentStep} of {STEPS.length} —{" "}
        <span className="font-medium text-gray-800">{STEPS[currentStep - 1]?.label}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5 sm:hidden">
        <div
          className="bg-red-600 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${(currentStep / 5) * 100}%` }}
        />
      </div>

      {/* Desktop: numbered circles */}
      <ol className="hidden sm:flex items-center w-full">
        {STEPS.map((s, i) => {
          const done = s.n < currentStep;
          const active = s.n === currentStep;
          return (
            <li key={s.n} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                    ${done ? "bg-red-600 text-white" : active ? "bg-red-600 text-white ring-2 ring-red-200" : "bg-gray-200 text-gray-500"}`}
                >
                  {done ? "✓" : s.n}
                </div>
                <span className={`mt-1 text-xs ${active ? "text-red-600 font-medium" : "text-gray-400"}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-5 ${done ? "bg-red-600" : "bg-gray-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
