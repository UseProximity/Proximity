// User/assistant message bubble. Ported behavior from
// apps/web/src/components/matchmaking/MessageBubble.js, adapted for native: a
// brief typing-dots pause before the bubble reveals (skipping web's
// character-by-character typewriter, which relies on a DOM-specific
// setInterval pattern with no equivalent elsewhere in this app) and no hover
// state for the "Edit" affordance (always visible here, not hover-only).
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

// Minimal markdown: only **bold** spans, matching web's renderRichText.
function RichText({ children, className }) {
  const parts = String(children ?? "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text className={className}>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <Text key={i} className="font-bold">
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

function TypingDots() {
  return (
    <View className="flex-row gap-1 py-1 px-0.5">
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400" style={{ opacity: 0.4 + i * 0.2 }} />
      ))}
    </View>
  );
}

export function ChatBubble({ message, onEdit }) {
  const isUser = message.role === "user";
  const [phase, setPhase] = useState(message.animate ? "typing" : "done");

  useEffect(() => {
    if (phase !== "typing") return;
    const t = setTimeout(() => setPhase("done"), 500);
    return () => clearTimeout(t);
  }, [phase]);

  if (isUser) {
    return (
      <View className="items-end mb-3 px-4">
        <View className="max-w-[85%] bg-red-600 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
          <Text className="text-white text-sm">{message.content}</Text>
        </View>
        {onEdit && message.questionId && (
          <Pressable onPress={() => onEdit(message.questionId)} hitSlop={8} className="mt-1 mr-1">
            <Text className="text-[11px] text-gray-400">Edit</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="flex-row items-end mb-3 px-4 gap-2">
      <View className="w-6 h-6 rounded-full bg-red-600 items-center justify-center mb-0.5">
        <Text className="text-white text-[11px] font-bold">P</Text>
      </View>
      <View className="max-w-[85%] bg-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
        {phase === "typing" ? <TypingDots /> : <RichText className="text-gray-900 text-sm">{message.content}</RichText>}
      </View>
    </View>
  );
}
