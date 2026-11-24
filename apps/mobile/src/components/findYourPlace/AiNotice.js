// Find Your Place, page 2: the notice that every search reaches Anthropic.
// Searching stays blocked until the student taps "I agree" (lib/aiConsent.js);
// a search tried before that bumps `nudge`, and the card shakes.
import { useEffect, useRef } from "react";
import { Animated, Text } from "react-native";
import { Button } from "../ui/Button";

export function AiNotice({ onAccept, nudge }) {
  const shift = useRef(new Animated.Value(0)).current;
  // The value already seen, so the card does not shake when it reappears.
  const seen = useRef(nudge);

  useEffect(() => {
    if (nudge === seen.current) return;
    seen.current = nudge;
    const to = (toValue) => Animated.timing(shift, { toValue, duration: 60, useNativeDriver: true });
    Animated.sequence([to(6), to(-6), to(4), to(0)]).start();
  }, [nudge, shift]);

  return (
    <Animated.View
      style={{ transform: [{ translateX: shift }] }}
      className="mx-4 mb-3 p-4 rounded-2xl border border-amber-200 bg-amber-50"
    >
      <Text accessibilityLiveRegion="polite" className="text-sm leading-5 text-amber-900">
        Find Your Place sends your answers and anything you type to Anthropic, a third-party AI provider, to find your matches.
      </Text>
      <Button onPress={onAccept} className="mt-3 self-start">
        I agree
      </Button>
    </Animated.View>
  );
}
