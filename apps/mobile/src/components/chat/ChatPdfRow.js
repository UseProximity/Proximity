import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Download, FileText } from "lucide-react-native";
import { formatFileSize } from "../../lib/chatFormat";
import { openChatPdf } from "../../lib/chatPdf";
import { getErrorMessage } from "../../lib/apiError";
import { showError } from "../../lib/showError";
import { ERROR_MESSAGES } from "../../lib/errorMessages";

export function isPdfAttachment(attachment) {
  return attachment?.contentType === "application/pdf";
}

// One PDF in a message: icon, file name and "PDF · size", as on web. Tapping downloads
// it through the authenticated attachment route and opens the system share sheet
// (see lib/chatPdf.js). `interactive={false}` draws it without the tap, for the
// long-press popup's copy of the bubble. `onLongPress` keeps the report gesture working
// on top of the row.
export function ChatPdfRow({ attachment, mine, interactive = true, onLongPress }) {
  const [busy, setBusy] = useState(false);
  const size = formatFileSize(attachment.sizeBytes);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openChatPdf(attachment);
    } catch (error) {
      if (error?.status === 401) return; // session expired: the api client already signed out
      showError(getErrorMessage(error, ERROR_MESSAGES.CHAT.OPEN_PDF));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={interactive ? open : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={!interactive && !onLongPress}
      accessibilityLabel={`Open ${attachment.fileName || "PDF"}`}
      className={`flex-row items-center rounded-xl px-2.5 py-2 ${
        mine ? "bg-red-500/40" : "bg-white"
      }`}
      style={{ gap: 10, minWidth: 200, maxWidth: 240 }}
    >
      <View
        className={`w-9 h-9 rounded-lg items-center justify-center ${
          mine ? "bg-red-500/50" : "bg-gray-100"
        }`}
      >
        <FileText size={18} color={mine ? "#ffffff" : "#4b5563"} strokeWidth={1.8} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className={`text-sm font-medium ${mine ? "text-white" : "text-gray-900"}`}>
          {attachment.fileName || "PDF"}
        </Text>
        <Text className={`text-[11px] ${mine ? "text-red-100" : "text-gray-500"}`}>
          {["PDF", size].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {interactive ? (
        busy ? (
          <ActivityIndicator size="small" color={mine ? "#ffffff" : undefined} />
        ) : (
          <Download size={16} color={mine ? "#fee2e2" : "#9ca3af"} strokeWidth={2} />
        )
      ) : null}
    </Pressable>
  );
}
