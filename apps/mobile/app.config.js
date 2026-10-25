const { distributableEnvProblems } = require("./src/lib/envGuard");
const { associatedDomainsFor } = require("./src/lib/linkDomains");

// EAS sets EAS_BUILD_PROFILE on the machine that builds. A preview, testflight or
// production build must not start from the local development environment
// (apps/mobile/.env.local is read here too), so fail the build before it can bundle
// a LAN URL, an insecure URL, a test-email override or a missing value. Development
// builds and plain `expo start` are not checked.
if (["preview", "testflight", "production"].includes(process.env.EAS_BUILD_PROFILE)) {
  const problems = distributableEnvProblems({
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_DEFAULT_KEY,
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
    testEmailTo: process.env.EXPO_PUBLIC_TEST_EMAIL_TO,
  });
  if (problems.length > 0) {
    throw new Error(
      `The "${process.env.EAS_BUILD_PROFILE}" build environment is not fit to ship:\n- ${problems.join("\n- ")}\n` +
        "Set these in the matching Expo environment (see eas.json) and make sure apps/mobile/.env.local is not part of the upload."
    );
  }
}

module.exports = {
  expo: {
    name: "Proximity",
    slug: "proximity",
    // "org.useproximity.app" is registered in addition to "proximity" so
    // Android has an intent-filter for expo-auth-session's Google OAuth
    // redirect, which defaults to `${applicationId}:/oauthredirect` on native
    // builds (see src/lib/googleAuth.js). Without this, Google's redirect
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
      // Library-only picking for Add Listing photos with no live camera capture,
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
      // channel (Android) at build time. There is no local ios/android project to
      // hand-edit, this is the only place that config is set.
      "expo-notifications",
      // Excludes SecureStore's encrypted values from Android Auto Backup.
      // Face ID is disabled (faceIDPermission: false): src/lib/secureStorage.js
      // doesn't use SecureStore's optional biometric-gated
      // `requireAuthentication`, so the Face ID string would be unused. The
      // matching Android biometric permissions are blocked below.
      ["expo-secure-store", { faceIDPermission: false }],
      // Launch screen: the red Proximity mark centred on white. SDK 56 has no
      // built-in splash handling, so this plugin is what applies the image on
      // both platforms at prebuild time.
      [
        "expo-splash-screen",
        {
          backgroundColor: "#ffffff",
          image: "./assets/splash-icon.png",
          imageWidth: 240,
          resizeMode: "contain",
        },
      ],
    ],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.proximityllc.proximity",
      // Universal Links: which paths open the app is decided by the site's
      // /.well-known/apple-app-site-association, built by apps/web/src/lib/appLinks/aasa.js
      // and served by the route handler under apps/web/src/app/.well-known/. /chat-link and
      // /messages are always advertised. /reset-password and /api/auth/verify-email are
      // advertised only where the web deployment explicitly sets APP_LINKS_AUTH_PATHS, which
      // is left off until a build that handles them is released. www is left out because it
      // redirects to the apex domain. A build whose API URL is the
      // staging deployment also claims the staging host (see src/lib/linkDomains.js), so
      // staging emails open a staging TestFlight build; production builds never do.
      associatedDomains: associatedDomainsFor(process.env.EXPO_PUBLIC_API_URL),
      infoPlist: {
        // The Mapbox map library links Apple's location APIs, so App Store Connect
        // warns (ITMS-90683) when this string is missing. The app never requests
        // location permission, so iOS never shows this text to a user.
        NSLocationWhenInUseUsageDescription:
          "Location access would allow Proximity to show your current position on a map. Proximity does not currently use your device location.",
      },
      // Only standard HTTPS (system TLS) is used, which is exempt from US export
      // rules. Sets ITSAppUsesNonExemptEncryption=false so App Store Connect
      // stops asking the export-compliance question on every upload.
      config: {
        usesNonExemptEncryption: false,
      },
      // Required-reason API declarations for the app target. Most dependencies ship their
      // own PrivacyInfo.xcprivacy (react-native, expo-constants, expo-device,
      // expo-file-system, expo-notifications), so only usage by code without a manifest is
      // declared here: @rnmapbox/maps writes UserDefaults in RNMBXModule.swift. No tracking
      // SDK is installed.
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
          },
        ],
        NSPrivacyTracking: false,
      },
    },
    android: {
      package: "org.useproximity.app",
      // Wires the downloaded Firebase config into the native Android build at
      // prebuild time (EAS Build or local `expo prebuild`/`run:android`) with no
      // manual Gradle edits: Expo's own config-plugin system copies the file
      // in, adds the com.google.gms:google-services classpath, and applies
      // the plugin automatically. This alone does NOT enable sending pushes:
      // that also needs an FCM v1 service-account key uploaded separately via
      // `eas credentials -p android`.
      googleServicesFile: "./google-services.json",
      // Library-contributed permissions the app never uses. Location comes from
      // the Mapbox SDK (the map only plots listing coordinates, never the
      // device), the overlay permission from Expo's prebuild defaults, and the
      // biometric pair from expo-secure-store (requireAuthentication is unused).
      blockedPermissions: [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.USE_BIOMETRIC",
        "android.permission.USE_FINGERPRINT",
      ],
      adaptiveIcon: {
        backgroundColor: "#e23a2f",
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
