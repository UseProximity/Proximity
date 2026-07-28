module.exports = {
  expo: {
    name: "Proximity",
    slug: "proximity",
    scheme: "proximity",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    plugins: ["expo-router", ["@rnmapbox/maps", { RNMapboxMapsVersion: "11.20.1" }]],
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
