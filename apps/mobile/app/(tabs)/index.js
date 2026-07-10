import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useAuthStore } from "../../src/store/authStore";

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const logout = useAuthStore((state) => state.logout);

  const tokenPreview = accessToken
    ? `${accessToken.slice(0, 20)}...${accessToken.slice(-10)}`
    : "none";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Logged in</Text>

      <View style={styles.card}>
        <Row label="ID" value={user?.id ?? "—"} />
        <Row label="Name" value={user?.name ?? "—"} />
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="Role" value={user?.role ?? "—"} />
        <Row label="Profile complete" value={String(user?.profileComplete ?? false)} />
        <Row label="Access token" value={tokenPreview} mono />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value, mono }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 60, backgroundColor: "#fff" },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 20, color: "#111" },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    backgroundColor: "#f9fafb",
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 13, color: "#6b7280", flex: 1 },
  value: { fontSize: 13, color: "#111", flex: 2, textAlign: "right" },
  mono: { fontFamily: "monospace", fontSize: 11 },
  logoutBtn: {
    marginTop: 32,
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  logoutText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
