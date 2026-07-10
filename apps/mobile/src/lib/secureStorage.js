import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// expo-secure-store is native-only. Fall back to localStorage on web.
const isWeb = Platform.OS === "web";

export async function get(key) {
  if (isWeb) return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function set(key, value) {
  if (isWeb) { localStorage.setItem(key, value); return; }
  return SecureStore.setItemAsync(key, value);
}

export async function remove(key) {
  if (isWeb) { localStorage.removeItem(key); return; }
  return SecureStore.deleteItemAsync(key);
}
