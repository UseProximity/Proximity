const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const finalConfig = withNativeWind(config, { input: "./global.css" });

// Force a single instance of react-native-css-interop. nativewind bundles
// its own nested copy (node_modules/nativewind/node_modules/react-native-css-interop)
// that npm won't dedupe against the hoisted one, so without this, Metro
// bundles two separate module instances of its style registry: the
// compiled-CSS module calls injectData() on one copy while our render
// path reads getStyle() from the other, and every className silently
// resolves to nothing.
const CSS_INTEROP_ROOT = path.resolve(projectRoot, "node_modules/react-native-css-interop");
const previousResolveRequest = finalConfig.resolver.resolveRequest;
finalConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = previousResolveRequest ?? context.resolveRequest;
  if (moduleName === "react-native-css-interop" || moduleName.startsWith("react-native-css-interop/")) {
    return resolve(context, moduleName.replace("react-native-css-interop", CSS_INTEROP_ROOT), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = finalConfig;
