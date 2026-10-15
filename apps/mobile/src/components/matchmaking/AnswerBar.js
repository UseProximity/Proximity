// Dispatches the active question's `kind` to the right native control and
// normalizes every control's output into the { questionId, field, kind,
// value, label? } shape apps/web/src/lib/matchmaking/questionEngine.js expects
// (see AnswerControls.js's `submit()` on web for the same contract).
import { UNSURE } from "@proximity/shared";
import { ChoiceChips } from "./ChoiceChips";
import { MultiChoiceChips } from "./MultiChoiceChips";
import { ConfirmOrReplace } from "./ConfirmOrReplace";
import { BudgetInput } from "./BudgetInput";
import { OpenTextInput } from "./OpenTextInput";

export function AnswerBar({ question, onAnswer }) {
  const { id, field, kind, options, meta } = question;
  const submit = (value, label) => onAnswer({ questionId: id, field, kind, value, ...(label ? { label } : {}) });

  switch (kind) {
    case "confirm_or_replace":
      return <ConfirmOrReplace currentName={meta?.currentName} onConfirm={submit} />;

    case "choice":
    case "yesno_pref":
    case "month_select":
      return (
        <ChoiceChips
          options={options.filter((o) => !/^other$/i.test(o))}
          allowOther
          unsureLabel="No Preference"
          onPick={submit}
          onUnsure={meta?.allowUnsure ? () => submit(UNSURE) : null}
        />
      );

    case "tradeoff":
      return (
        <ChoiceChips
          options={options}
          allowOther={false}
          unsureLabel="No strong preference"
          onPick={submit}
          onUnsure={meta?.allowUnsure ? () => submit(UNSURE) : null}
        />
      );

    case "multi":
      return (
        <MultiChoiceChips
          options={options}
          allowOther
          escapeLabel={meta?.allowUnsure ? "No Preference" : null}
          onSend={(values) => submit(values)}
          onEscape={() => submit(UNSURE)}
        />
      );

    case "contact":
      return (
        <MultiChoiceChips
          options={options}
          allowOther={false}
          escapeLabel="No thanks"
          onSend={(values) => submit(values)}
          onEscape={() => submit([], "No thanks")}
        />
      );

    case "budget_max":
      return (
        <BudgetInput
          maxLabel={meta?.maxLabel}
          onSend={(value) => submit(value)}
          onUnsure={() => submit(UNSURE)}
        />
      );

    case "open_text":
      return (
        <OpenTextInput
          placeholder={meta?.placeholder}
          onSend={(text) => submit(text)}
          onSkip={() => submit(UNSURE)}
        />
      );

    default:
      return null;
  }
}
