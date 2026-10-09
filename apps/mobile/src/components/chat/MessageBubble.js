import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { formatMessageTime } from "../../lib/chatFormat";
import { ChatAttachmentImages, isImageAttachment } from "./ChatAttachmentImages";

// One chat message. Sent messages sit on the right in brand red, received ones
// on the left in gray. `senderName` is shown above the first received bubble of
// a run, and `listingLabel` as a small centered note when the conversation
// moves to a different property. `onLongPress` (received messages only) opens
// the report flow for that message; it receives the bubble's position in the
// window ({ x, y, width, height }) so the popup can redraw the bubble in place.
// Photos in an attachment message are drawn inline; `onOpenPhotos(photos, index)`
// is called when one is tapped. Files other than photos (PDFs sent from the web)
// are listed by name and cannot be opened here yet.
export function MessageBubble({ message, senderName, listingLabel, onLongPress, onOpenPhotos }) {
  const mine = !!message.isMine;
  const isAttachment = message.messageType === "attachment";
  const attachments = isAttachment && Array.isArray(message.metadata?.attachments)
    ? message.metadata.attachments
    : [];
  const photos = attachments.filter(isImageAttachment);
  const otherFiles = attachments.filter((attachment) => !isImageAttachment(attachment));
  const hasAttachmentContent = attachments.length > 0;
  const caption =
    typeof message.metadata?.caption === "string" ? message.metadata.caption.trim() : "";
  const bubbleRef = useRef(null);

  const handleLongPress = () => {
    if (!onLongPress) return;
    const view = bubbleRef.current;
    if (!view?.measureInWindow) return;
    view.measureInWindow((x, y, width, height) => onLongPress({ x, y, width, height }));
  };

  return (
    <View className="px-4 mb-2">
      {listingLabel ? (
        <Text className="text-[11px] text-gray-400 text-center my-2" numberOfLines={1}>
          About {listingLabel}
        </Text>
      ) : null}
      {!mine && senderName ? (
        <Text className="text-[11px] text-gray-500 mb-0.5 ml-1">{senderName}</Text>
      ) : null}
      <View className={mine ? "items-end" : "items-start"}>
        <Pressable
          ref={bubbleRef}
          onLongPress={handleLongPress}
          delayLongPress={350}
          disabled={!onLongPress}
          className={`max-w-[85%] rounded-2xl ${
            hasAttachmentContent && photos.length > 0 ? "p-1" : "px-3.5 py-2.5"
          } ${mine ? "bg-red-600 rounded-tr-sm" : "bg-gray-100 rounded-tl-sm"} ${
            message.pending ? "opacity-60" : ""
          }`}
        >
          {hasAttachmentContent ? (
            <>
              {photos.length > 0 ? (
                <ChatAttachmentImages
                  attachments={photos}
                  onOpen={onOpenPhotos ? (index) => onOpenPhotos(photos, index) : undefined}
                  onLongPress={handleLongPress}
                />
              ) : null}
              {otherFiles.map((file, index) => (
                <Text
                  key={file.id ?? `${file.fileName}-${index}`}
                  numberOfLines={1}
                  className={`text-sm ${mine ? "text-white" : "text-gray-900"}`}
                >
                  {file.fileName || "File"}
                </Text>
              ))}
              {otherFiles.length > 0 ? (
                <Text className={`text-[11px] mt-1 ${mine ? "text-red-100" : "text-gray-500"}`}>
                  Files other than photos can&apos;t be opened in the app yet
                </Text>
              ) : null}
              {caption ? (
                <Text
                  className={`text-sm ${photos.length > 0 ? "px-2.5 pt-1.5 pb-1" : "mt-1"} ${
                    mine ? "text-white" : "text-gray-900"
                  }`}
                >
                  {caption}
                </Text>
              ) : null}
            </>
          ) : (
            <Text className={`text-sm ${mine ? "text-white" : "text-gray-900"}`}>
              {message.body || (isAttachment ? "Sent a file" : "")}
            </Text>
          )}
        </Pressable>
        <Text className="text-[10px] text-gray-400 mt-0.5 mx-1">
          {message.pending ? "Sending..." : formatMessageTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}
