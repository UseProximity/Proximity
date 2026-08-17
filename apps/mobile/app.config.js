module.exports = {
  expo: {
    name: "Proximity",
    slug: "proximity",
    // "org.useproximity.app" is registered in addition to "proximity" so
    // Android has an intent-filter for expo-auth-session's Google OAuth
    // redirect, which defaults to `${applicationId}:/oauthredirect` on native
    // builds (see src/lib/googleAuth.js) — without this, Google's redirect
    // has nowhere to go and the auth session is silently dismissed.
    scheme: ["proximity", "org.useproximity.app"],
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    plugins: [
      "expo-router",
      ["@rnmapbox/maps", { RNMapboxMapsVersion: "11.20.1" }],
      // Library-only picking for Add Listing photos — no live camera capture,
      // so camera/microphone permissions are declined rather than requested.
      [
        "expo-image-picker",
        {
          photosPermission: "Proximity uses your photo library to let landlords add listing photos.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    ios: {
      supportsTablet: true,
    },
    android: {
      package: "org.useproximity.app",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
    },
  },
};
