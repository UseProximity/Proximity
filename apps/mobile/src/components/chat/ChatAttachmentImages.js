import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { ImageOff } from "lucide-react-native";
import { getChatImageUri } from "../../lib/chatImageCache";

export function isImageAttachment(attachment) {
  return typeof attachment?.contentType === "string" && attachment.contentType.startsWith("image/");
}

// What an <Image> needs to show a chat attachment: a local file. Sent photos are
// downloaded through the authenticated attachment route and cached on the device
// (lib/chatImageCache.js), so the token is renewed and the request retried the same
// way as any other api call, and the <Image> itself needs no credentials. A photo
// that is still on this device (an attachment with `localUri`) is shown directly.
//
// `retry` fetches the photo again, discarding the cached file. `failed` is true when
// the download itself did not succeed. Callers key this component by the attachment
// (id or localUri), so one mounted instance only ever shows one attachment.
export function useAttachmentSource(attachment) {
  const localUri = attachment?.localUri;
  const id = attachment?.id;
  const contentType = attachment?.contentType;
  const [source, setSource] = useState(localUri ? { uri: localUri } : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Set by `retry`, consumed by the next load: that load must not reuse the cache.
  const freshRef = useRef(false);

  useEffect(() => {
    if (localUri || !id) return undefined;
    let cancelled = false;
    const fresh = freshRef.current;
    freshRef.current = false;
    setFailed(false);
    getChatImageUri({ id, contentType }, { fresh })
      .then((uri) => {
        if (!cancelled) setSource({ uri });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, contentType, localUri, attempt]);

  const retry = useCallback(() => {
    if (!localUri) {
      freshRef.current = true;
      setSource(null);
    }
    setAttempt((value) => value + 1);
  }, [localUri]);

  return { source, attempt, failed, retry };
}

// Loading state for one attachment image, shared by the inline tiles and the
// full-screen viewer. A load failure triggers exactly one silent retry (a fresh
// download); a second failure puts it in the "error" state, from which only
// `retryNow` (the user tapping) tries again, so it can never loop or stay blank.
// `status` is "loading", "loaded" or "error".
export function useAttachmentImage(attachment) {
  const { source, attempt, failed, retry } = useAttachmentSource(attachment);
  const [phase, setPhase] = useState("loading");
  const autoRetried = useRef(false);

  const onLoad = useCallback(() => setPhase("loaded"), []);
  const onError = useCallback(() => {
    if (!autoRetried.current) {
      autoRetried.current = true;
      retry();
      return;
    }
    setPhase("error");
  }, [retry]);
  const retryNow = useCallback(() => {
    setPhase("loading");
    retry();
  }, [retry]);

  return { source, attempt, status: failed ? "error" : phase, onLoad, onError, retryNow };
}

function Thumbnail({ attachment, size, onPress, onLongPress }) {
  const { source, attempt, status, onLoad, onError, retryNow } = useAttachmentImage(attachment);

  return (
    <Pressable
      onPress={status === "error" ? retryNow : onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={{ width: size.width, height: size.height }}
      className="rounded-xl overflow-hidden bg-gray-200"
      accessibilityLabel={attachment.fileName || "Photo"}
    >
      {source && status !== "error" ? (
        <Image
          key={attempt}
          source={source}
          alt={attachment.fileName || "Photo"}
          style={{ width: size.width, height: size.height }}
          resizeMode="cover"
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
      {status === "loading" ? (
        <View
          className="items-center justify-center"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <ActivityIndicator />
        </View>
      ) : null}
      {status === "error" ? (
        <View className="flex-1 items-center justify-center px-2">
          <ImageOff size={22} color="#6b7280" strokeWidth={2} />
          <Text className="text-[11px] text-gray-500 mt-1 text-center">Tap to retry</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const SINGLE = { width: 220, height: 220 };
const MULTI = { width: 108, height: 108 };

// The photos of one message: one large square, or a two-column grid. `onOpen(index)`
// is given the index among the photos shown here.
export function ChatAttachmentImages({ attachments, onOpen, onLongPress }) {
  const images = attachments.filter(isImageAttachment);
  if (images.length === 0) return null;
  const size = images.length === 1 ? SINGLE : MULTI;
  return (
    <View className="flex-row flex-wrap" style={{ width: 220, gap: 4 }}>
      {images.map((attachment, index) => (
        <Thumbnail
          key={attachment.id ?? attachment.localUri ?? `${attachment.fileName}-${index}`}
          attachment={attachment}
          size={size}
          onPress={onOpen ? () => onOpen(index) : undefined}
          onLongPress={onLongPress}
        />
      ))}
    </View>
  );
}
