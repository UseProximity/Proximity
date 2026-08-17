// Screen 1: just the address. Picking a Mapbox suggestion captures
// coordinates (walk times, map pin) — mirrors
// apps/web/src/components/listings/wizard/StepAddress.js. Mobile skips the
// Street View preview web shows here: the wizard shell decides whether to
// attach it at publish time based on whether photos were staged, so there's
// nothing to confirm/delete client-side. Website-import ("confirm the
// address" mode) is out of scope for mobile v1.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { colors } from "../../../theme/tokens";
import { StepFrame } from "./wizardShared";

export default function StepAddress({ w }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(w.coords.lat != null);
  const debounceRef = useRef(null);

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  const fetchSuggestions = (text) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text || text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      setLoading(true);
      try {
        const encoded = encodeURIComponent(text.trim());
        // Biases ranking toward the WashU area, same as web's StepAddress.
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&country=US&types=address,place&proximity=-90.3123,38.6488`
        );
        const data = await res.json();
        setSuggestions((data.features ?? []).map((f) => ({ label: f.place_name, center: f.center })));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const select = (s) => {
    const autoTitle = s.label.split(",")[0].trim();
    w.setField("address", s.label);
    if (!w.form.title) w.setField("title", autoTitle);
    setSuggestions([]);
    setConfirmed(true);
    const [lng, lat] = s.center ?? [];
    if (lat != null && lng != null) w.setCoords({ lat, lng });
  };

  return (
    <StepFrame
      title="Where's the property?"
      subtitle="This sets the map pin and real walk times to campus. You'll pick the display name students see later."
    >
      <View className="relative">
        <TextInput
          value={w.form.address}
          onChangeText={(text) => {
            setConfirmed(false);
            w.setField("address", text);
            fetchSuggestions(text);
          }}
          autoFocus
          placeholder="123 Main St, St. Louis, MO 63130"
          placeholderTextColor="#9ca3af"
          className="h-12 border border-gray-200 rounded-xl px-4 pr-10 text-base text-gray-900 bg-gray-50"
        />
        {loading ? (
          <View className="absolute right-3 top-0 bottom-0 justify-center">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </View>

      {suggestions.length > 0 ? (
        <View className="mt-1.5 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {suggestions.map((s, i) => (
            <Pressable
              key={i}
              onPress={() => select(s)}
              className={`px-3.5 py-3 ${i < suggestions.length - 1 ? "border-b border-gray-100" : ""}`}
            >
              <Text className="text-sm text-gray-700">{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {confirmed && suggestions.length === 0 ? (
        <Text className="mt-2 text-xs text-green-700">✓ On the map. Walk times will be calculated automatically.</Text>
      ) : null}
    </StepFrame>
  );
}
