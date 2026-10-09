import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Flag } from "lucide-react-native";
import { formatMessageTime } from "../../lib/chatFormat";
import { ChatAttachmentImages, isImageAttachment } from "./ChatAttachmentImages";

// The chat screen's two small popups, in the style of Instagram's: the
// conversation options menu and the long-press menu on a received message. They
// share one Modal so switching between them never waits on a dismiss animation.
// Block and Report are not here: they are native form sheets (app/chat-sheet/),
// which iOS lets the user drag down to dismiss. The screen owns the state and the
// handlers; this file only draws and forwards taps.
//
// `sheet` is null (closed) or one of:
//   { type: "options" }
//   { type: "message", message, rect }  (rect: the bubble's window position)

// Slides the panel up and fades it in. Keyed by sheet type so a swap replays it.
function SlideUp({ children }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function SheetRow({ label, onPress, destructive, first, bold }) {
  return (
    <Pressable
      onPress={onPress}
      className={`items-center justify-center active:bg-gray-100 ${
        first ? "" : "border-t border-gray-200"
      }`}
      style={{ height: 54 }}
    >
      <Text
        className={`text-base ${bold ? "font-semibold" : ""} ${
          destructive ? "text-red-600" : "text-gray-900"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OptionsPanel({ onReport, onBlock, onClose, bottomInset }) {
  return (
    <View className="px-3" style={{ paddingBottom: bottomInset + 8 }}>
      <View className="bg-white rounded-2xl overflow-hidden">
        <SheetRow first label="Report" destructive bold onPress={onReport} />
        <SheetRow label="Block" destructive bold onPress={onBlock} />
      </View>
      <View className="bg-white rounded-2xl overflow-hidden mt-2">
        <SheetRow first label="Cancel" onPress={onClose} />
      </View>
    </View>
  );
}

const CARD_WIDTH = 220;
const CARD_TIME_HEIGHT = 32;
const CARD_ROW_HEIGHT = 54;
const GAP = 8;
const EDGE = 12;

// The long-pressed message, redrawn exactly where it was (`rect` is its window
// position) so it covers the original under the backdrop, with the Report card
// right next to it: below when there is room, otherwise above.
function MessagePanel({ message, rect, onReport, onClose }) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const time = formatMessageTime(message?.createdAt);
  const isAttachment = message?.messageType === "attachment";
  const attachments =
    isAttachment && Array.isArray(message?.metadata?.attachments) ? message.metadata.attachments : [];
  const photos = attachments.filter(isImageAttachment);
  const otherFiles = attachments.filter((attachment) => !isImageAttachment(attachment));
  const caption =
    typeof message?.metadata?.caption === "string" ? message.metadata.caption.trim() : "";
  const cardH = CARD_ROW_HEIGHT + (time ? CARD_TIME_HEIGHT : 0);

  const bubbleTop = rect.y;
  const bubbleBottom = rect.y + rect.height;
  const minTop = insets.top + EDGE;
  const maxBottom = screenH - insets.bottom - EDGE;
  let cardTop = bubbleBottom + GAP;
  if (cardTop + cardH > maxBottom) {
    const above = bubbleTop - GAP - cardH;
    // Neither side has room (a very tall bubble): pin the card to the bottom.
    cardTop = above >= minTop ? above : maxBottom - cardH;
  }
  const cardLeft = Math.min(Math.max(rect.x, EDGE), screenW - CARD_WIDTH - EDGE);

  return (
    <>
      <Pressable
        onPress={onClose}
        className={`bg-gray-100 rounded-2xl rounded-tl-sm ${
          photos.length > 0 ? "p-1" : "px-3.5 py-2.5"
        }`}
        style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width }}
      >
        {attachments.length > 0 ? (
          <>
            <ChatAttachmentImages attachments={photos} />
            {otherFiles.map((file, index) => (
              <Text key={file.id ?? `${file.fileName}-${index}`} numberOfLines={1} className="text-sm text-gray-900">
                {file.fileName || "File"}
              </Text>
            ))}
            {otherFiles.length > 0 ? (
              <Text className="text-[11px] mt-1 text-gray-500">
                Files other than photos can&apos;t be opened in the app yet
              </Text>
            ) : null}
            {caption ? (
              <Text className={`text-sm text-gray-900 ${photos.length > 0 ? "px-2.5 pt-1.5 pb-1" : "mt-1"}`}>
                {caption}
              </Text>
            ) : null}
          </>
        ) : (
          <Text className="text-sm text-gray-900">
            {message?.body || (isAttachment ? "Sent a file" : "")}
          </Text>
        )}
      </Pressable>
      <View
        className="bg-white rounded-2xl overflow-hidden"
        style={{ position: "absolute", left: cardLeft, top: cardTop, width: CARD_WIDTH }}
      >
        {time ? (
          <Text
            className="text-xs text-gray-500 px-4 uppercase tracking-wide"
            style={{ height: CARD_TIME_HEIGHT, paddingTop: 12 }}
          >
            {time}
          </Text>
        ) : null}
        <Pressable
          onPress={onReport}
          className="flex-row items-center justify-between px-4 active:bg-gray-100"
          style={{ height: CARD_ROW_HEIGHT }}
        >
          <Text className="text-base text-red-600">Report</Text>
          <Flag size={20} color="#dc2626" strokeWidth={2} />
        </Pressable>
      </View>
    </>
  );
}

export function ChatSheets({
  sheet,
  onClose,
  onDismissed,
  onPickReport,
  onPickBlock,
  onReportMessage,
}) {
  const insets = useSafeAreaInsets();
  const type = sheet?.type;

  return (
    <Modal
      visible={!!sheet}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <View className="flex-1">
        <Pressable
          className="bg-black/50"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        {type === "message" && sheet.rect ? (
          <MessagePanel
            message={sheet.message}
            rect={sheet.rect}
            onReport={() => onReportMessage(sheet.message.id)}
            onClose={onClose}
          />
        ) : null}
        {type === "options" ? (
          <View className="flex-1 justify-end" pointerEvents="box-none">
            <SlideUp>
              <OptionsPanel
                onReport={onPickReport}
                onBlock={onPickBlock}
                onClose={onClose}
                bottomInset={insets.bottom}
              />
            </SlideUp>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
