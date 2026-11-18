// Find Your Place tab: answer a few questions, get the four places that fit
// best. The same three pages as the website's /find-your-place
// (apps/web/src/components/findYourPlace/), against the same API
// (POST /api/find-your-place), laid out for a phone: a progress bar and Start
// over on top, the page in a scroll view, and Back / Next at the bottom.
// State and the saved run live in store/findYourPlaceStore.js.
//
// Signed in only: a signed-out user is shown the sign-in screen. Every search
// reaches Anthropic, so a signed-in user first agrees to that (lib/aiConsent.js).
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QUESTION_COUNT, answeredCount } from "@proximity/shared";
import { useAuthStore } from "../../src/store/authStore";
import { useFindYourPlaceStore } from "../../src/store/findYourPlaceStore";
import { LoggedOutScreen } from "../../src/components/brand/LoggedOutScreen";
import { Button } from "../../src/components/ui/Button";
import { ProgressBar } from "../../src/components/findYourPlace/ui";
import { StepBasics } from "../../src/components/findYourPlace/StepBasics";
import { StepPreferences } from "../../src/components/findYourPlace/StepPreferences";
import { StepMatches } from "../../src/components/findYourPlace/StepMatches";
import { useAiConsent } from "../../src/lib/aiConsent";
import { openLegalLink, PRIVACY_URL } from "../../src/lib/legalLinks";

// The five questions fill the bar to here; it completes on "Show My Matches".
const QUESTIONS_FILL = 0.8;

function FooterButton({ primary = false, disabled = false, onPress, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`h-10 px-5 rounded-full items-center justify-center ${
        primary ? (disabled ? "bg-gray-200" : "bg-red-600 active:bg-red-700") : "bg-gray-100 active:bg-gray-200"
      }`}
    >
      <Text className={`text-sm font-semibold ${primary ? (disabled ? "text-gray-400" : "text-white") : "text-gray-700"}`}>
        {children}
      </Text>
    </Pressable>
  );
}

function ConsentScreen({ onAgree }) {
  const [declined, setDeclined] = useState(false);
  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <Text className="text-lg font-bold text-gray-900 mb-3">Before you start</Text>
      <Text className="text-sm text-gray-500 text-center mb-3">
        Find Your Place uses Anthropic, a third-party AI provider, to read your answers and choose your matches.
      </Text>
      <Text className="text-sm text-gray-500 text-center mb-4">
        Your answers, and anything you write on the second page, may be shared with Anthropic for this purpose.
      </Text>
      <Pressable onPress={() => openLegalLink(PRIVACY_URL)} hitSlop={8} className="mb-6">
        <Text className="text-sm font-semibold text-gray-900 underline">Privacy Policy</Text>
      </Pressable>
      <Button onPress={onAgree} className="self-stretch">
        Agree & continue
      </Button>
      <Button variant="ghost" onPress={() => setDeclined(true)} className="self-stretch mt-2">
        Not now
      </Button>
      {declined ? (
        <Text className="text-xs text-gray-500 text-center mt-3">
          Find Your Place needs this to work. You can agree whenever you&apos;re ready.
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

export default function FindYourPlaceScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const isAuthHydrated = useAuthStore((s) => s.isHydrated);
  const consent = useAiConsent(userId);
  const store = useFindYourPlaceStore();
  const { owner, step, answers, text, chips, results, loading, error, round } = store;
  const scrollRef = useRef(null);

  // Reads this account's saved run once it has agreed (and again after a switch
  // of account, which clears the store).
  useEffect(() => {
    if (userId && consent.status === "granted") store.load(userId);
  }, [userId, consent.status, owner]);

  // Each page starts at its top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  if (!isAuthHydrated || (userId && consent.status === "loading")) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!userId) {
    return (
      <LoggedOutScreen
        title="Sign in to use Find Your Place"
        description="Answer a few quick questions and get free personalized off-campus housing matches near WashU."
      />
    );
  }

  if (consent.status !== "granted") return <ConsentScreen onAgree={consent.grant} />;

  if (owner !== userId) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  const answered = answeredCount(answers);
  const canStartOver = step > 1 || answered > 0 || answers.modes.length > 0 || !!text || !!results;
  // Full as soon as the matches are asked for, not when they arrive.
  const progress = step === 1 ? (answered / QUESTION_COUNT) * QUESTIONS_FILL : step === 2 ? QUESTIONS_FILL : 1;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center gap-4 px-4 py-3 border-b border-gray-100">
        <View className="flex-1">
          <ProgressBar value={progress} />
        </View>
        {/* Always in the same place; only live once there is something to clear. */}
        <Pressable
          onPress={store.startOver}
          disabled={!canStartOver}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canStartOver }}
          className={canStartOver ? "" : "opacity-0"}
        >
          <Text className="text-xs font-medium text-gray-500">Start over</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="p-4 pb-6"
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <StepBasics
              key={round}
              answers={answers}
              onChange={store.setAnswers}
              onFollowUpShown={() => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))}
            />
          )}
          {step === 2 && (
            <StepPreferences
              text={text}
              chips={chips}
              onChange={store.setPreferences}
              onSkip={() => store.run({ text: "", chips: {} })}
            />
          )}
          {step === 3 && (
            <StepMatches
              loading={loading}
              error={error}
              results={results}
              onRetry={() => store.run({}, { force: true })}
              onFixAnswers={() => {
                store.clearError();
                store.setStep(1);
              }}
            />
          )}
        </ScrollView>

        <View className="flex-row items-center justify-between px-4 py-3 border-t border-gray-100 bg-white">
          {step > 1 ? (
            <FooterButton onPress={() => store.setStep(step - 1)}>{step === 3 ? "Edit Preferences" : "Back"}</FooterButton>
          ) : (
            <View />
          )}
          {step === 1 && (
            <FooterButton primary disabled={answered < QUESTION_COUNT} onPress={() => store.setStep(2)}>
              Next
            </FooterButton>
          )}
          {step === 2 && (
            <FooterButton primary onPress={() => store.run()}>
              Show My Matches
            </FooterButton>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
