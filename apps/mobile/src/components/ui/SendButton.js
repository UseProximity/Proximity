import { Pressable } from "react-native";
import { ArrowRight } from "lucide-react-native";

// Shared circular submit-affordance for matchmaking's typed-answer controls
// (ChoiceChips, MultiChoiceChips, BudgetInput, ConfirmOrReplace,
// OpenTextInput) — each previously hand-rolled this exact Pressable
// (design-system/pages/chat.md). A distinct component from ui/Chip.js: this
// is a submit action, not an option picker, even though both are
// pill/circle shapes sharing the same red/gray coloring. `className` lets
// call sites add their own layout positioning (e.g. `self-end`, `ml-auto`)
// without baking a specific layout assumption into the shared component.
export function SendButton({ onPress, disabled, className = "" }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`w-9 h-9 rounded-full items-center justify-center ${
        disabled ? "bg-red-200" : "bg-red-600"
      } ${className}`}
    >
      <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
    </Pressable>
  );
}
