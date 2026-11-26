import { Alert } from "react-native";

// Asks whether to send a message the server flagged with 409 CONFIRM_SEND. Resolves
// true only when the person taps "Send anyway"; Edit, a tap outside the dialog and
// the Android back button all resolve false, so nothing is ever sent without a tap.
export function confirmSendAnyway(message) {
  return new Promise((resolve) => {
    Alert.alert(
      "Send anyway?",
      message,
      [
        { text: "Edit", style: "cancel", onPress: () => resolve(false) },
        { text: "Send anyway", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
