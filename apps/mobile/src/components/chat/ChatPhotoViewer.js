import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ImageOff, X } from "lucide-react-native";
import { useAttachmentImage } from "./ChatAttachmentImages";
import { ERROR_MESSAGES } from "../../lib/errorMessages";

// Full-screen photo viewer. Swipe sideways between a message's photos; on iOS pinch
// to zoom. `photos` is the list of image attachments, `index` the one to start on.
function Page({ attachment, width, height }) {
  const { source, attempt, status, onLoad, onError, retryNow } = useAttachmentImage(attachment);
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height, justifyContent: "center" }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      bouncesZoom
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      {source && status !== "error" ? (
        <Image
          key={attempt}
          source={source}
          alt={attachment.fileName || "Photo"}
          style={{ width, height }}
          resizeMode="contain"
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
      {status === "loading" ? (
        <View
          className="items-center justify-center"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : null}
      {status === "error" ? (
        <Pressable onPress={retryNow} className="items-center justify-center" accessibilityLabel="Retry loading photo">
          <ImageOff size={32} color="#d1d5db" strokeWidth={1.8} />
          <Text className="text-white text-base mt-3">{ERROR_MESSAGES.CHAT.IMAGE_LOAD_FAILED}</Text>
          <Text className="text-gray-300 text-sm mt-1">{ERROR_MESSAGES.CHAT.IMAGE_TAP_TRY_AGAIN}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export function ChatPhotoViewer({ photos, index, onClose }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const open = !!photos && photos.length > 0;

  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {open ? (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.min(index, photos.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(item, i) => item.id ?? item.localUri ?? String(i)}
            renderItem={({ item }) => <Page attachment={item} width={width} height={height} />}
            showsHorizontalScrollIndicator={false}
          />
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="Close photo"
          className="absolute right-4 w-10 h-10 rounded-full bg-black/60 items-center justify-center"
          style={{ top: insets.top + 8 }}
        >
          <X size={22} color="#ffffff" strokeWidth={2.2} />
        </Pressable>
        {open && photos.length > 1 ? (
          <Text className="absolute self-center text-white text-sm" style={{ top: insets.top + 18 }}>
            {photos.length} photos
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}
