"use client";

import { useReducer } from "react";
import WizardProgress from "./_components/WizardProgress";
import Step1Upload from "./_components/Step1Upload";
import Step2VerifyDetails from "./_components/Step2VerifyDetails";
import Step3LeaseTerms from "./_components/Step3LeaseTerms";
import Step4PetsAndFees from "./_components/Step4PetsAndFees";
import Step5Publish from "./_components/Step5Publish";

const INITIAL = {
  step: 1,
  listingId: null,
  templateId: null,
  fieldStates: {},     // { "table.field": { state, suggested_value, ai_confidence } }
  listing: null,       // latest fetched listing snapshot
  leases: [],          // listing_leases rows
  petPolicy: "",
  fees: [],
  concessions: [],
  isExtracting: false,
  extractionError: null,
};

function reducer(state, action) {
  switch (action.type) {
    case "NEXT":         return { ...state, step: Math.min(state.step + 1, 8) };
    case "BACK":         return { ...state, step: Math.max(state.step - 1, 1) };
    case "GO_STEP":      return { ...state, step: action.step };
    case "SET_LISTING":  return { ...state, listingId: action.listingId, listing: action.listing };
    case "SET_TEMPLATE": return { ...state, templateId: action.templateId };
    case "FIELD_STATES": return { ...state, fieldStates: action.fieldStates };
    case "SET_LISTING_DATA": return { ...state, listing: { ...state.listing, ...action.data } };
    case "SET_LEASES":   return { ...state, leases: action.leases };
    case "SET_PET_POLICY": return { ...state, petPolicy: action.petPolicy };
    case "SET_FEES":     return { ...state, fees: action.fees };
    case "SET_CONCESSIONS": return { ...state, concessions: action.concessions };
    case "EXTRACTING":   return { ...state, isExtracting: action.value, extractionError: null };
    case "EXTRACT_ERROR": return { ...state, isExtracting: false, extractionError: action.error };
    default:             return state;
  }
}

const STEP_LABELS = ["Upload & analyse", "Verify details", "Lease terms", "Fees & policy", "Publish"];

export default function AddListingWizard() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const { step } = state;

  const next = () => dispatch({ type: "NEXT" });
  const back = () => dispatch({ type: "BACK" });

  const stepProps = { state, dispatch, onNext: next, onBack: back };

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Add a listing</h1>
      <p className="text-sm text-gray-500 mb-6">
        {STEP_LABELS[step - 1]} — step {step} of 5
      </p>
      <WizardProgress currentStep={step} />

      {step === 1 && <Step1Upload {...stepProps} />}
      {step === 2 && <Step2VerifyDetails {...stepProps} />}
      {step === 3 && <Step3LeaseTerms {...stepProps} />}
      {step === 4 && <Step4PetsAndFees {...stepProps} />}
      {step === 5 && <Step5Publish {...stepProps} />}
    </main>
  );
}
