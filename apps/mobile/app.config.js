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
      // Adds the com.apple.developer.applesignin entitlement (iOS only).
      "expo-apple-authentication",
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
      // Registers the APNs entitlement (iOS) and default notification
      // channel (Android) at build time — no local ios/android project to
      // hand-edit, this is the only place that config is set.
      "expo-notifications",
      // Excludes SecureStore's encrypted values from Android Auto Backup and
      // adds the (unused but required-to-declare) iOS Face ID permission
      // string — defaults are correct here, src/lib/secureStorage.js doesn't
      // use SecureStore's optional biometric-gated `requireAuthentication`.
      "expo-secure-store",
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.proximityllc.proximity",
    },
    android: {
      package: "org.useproximity.app",
      // Wires the downloaded Firebase config into the native Android build at
      // prebuild time (EAS Build or local `expo prebuild`/`run:android`) — no
      // manual Gradle edits: Expo's own config-plugin system copies the file
      // in, adds the com.google.gms:google-services classpath, and applies
      // the plugin automatically. This alone does NOT enable sending pushes —
      // that also needs an FCM v1 service-account key uploaded separately via
      // `eas credentials -p android`.
      googleServicesFile: "./google-services.json",
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
      eas: {
        projectId: "d7d2b10d-0957-441e-8484-5510276d22b6",
      },
    },
  },
};
