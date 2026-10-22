import { Alert } from "react-native";

// A failed one-off action with no place on screen to put the message (delete,
// toggle, report, block, favourite): a native alert with one consistent title.
export function showError(message) {
  Alert.alert("Error", message);
}
