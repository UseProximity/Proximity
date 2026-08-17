// Screen 5: photos. Deliberately low-pressure — phone photos are fine, more
// can be added post-publish. Order here is upload order, first photo is the
// cover. Mirrors apps/web/src/components/listings/wizard/StepPhotos.js,
// minus drag-to-reorder (no gesture-reorder lib installed for mobile v1 —
// remove and re-add to fix order) and the Street View preview (the shell
// only attaches Street View when no photos are staged, so there's nothing
// to confirm/delete here — see publish() in listings/add/index.js).
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { colors } from "../../../theme/tokens";
import { StepFrame } from "./wizardShared";

export default function StepPhotos({ w }) {
  const [preparing, setPreparing] = useState(false);

  const handleAdd = async () => {
    setPreparing(true);
    try {
      await w.addImages();
    } finally {
      setPreparing(false);
    }
  };

  return (
    <StepFrame title="Add some photos" subtitle="First photo is the cover. You can add more after publishing.">
      {w.stagedImages.length > 0 ? (
        <View className="flex-row flex-wrap gap-2.5 mb-4">
          {w.stagedImages.map((img, i) => (
            <View key={img.uri} className="relative h-24 w-24">
              <Image source={{ uri: img.uri }} className="h-full w-full rounded-lg border border-gray-200" />
              {i === 0 ? (
                <View className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 py-0.5">
                  <Text className="text-center text-[9px] text-white">Cover</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => w.removeStagedImage(i)}
                hitSlop={8}
                className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-red-600"
              >
                <Text className="text-white text-xs leading-none">×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={handleAdd}
        disabled={preparing}
        className="h-32 w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300"
      >
        {preparing ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text className="mb-1 text-2xl">📷</Text>
            <Text className="text-sm font-medium text-gray-500">Tap to add photos</Text>
          </>
        )}
      </Pressable>
    </StepFrame>
  );
}
