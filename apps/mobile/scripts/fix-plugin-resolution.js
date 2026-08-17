#!/usr/bin/env node
//
// expo-image-picker/expo-image-manipulator's Expo config plugins do a plain
// Node require("expo/config-plugins"), which only walks upward from
// wherever npm physically placed the package — unlike Metro's app-bundling
// resolver, which checks multiple configured paths. npm has no version
// conflict forcing these two into apps/mobile/node_modules (unlike
// @rnmapbox/maps, which does), so they get hoisted to the monorepo root — a
// sibling of, not an ancestor of, apps/mobile/node_modules, where `expo`
// itself lives. Result: `expo prebuild` and `expo start` crash with
// "Cannot find module 'expo/config-plugins'".
//
// A monorepo-wide install-strategy=nested fix was tried and reverted — it
// broke react-native-css-interop's own hoisting-dependent resolution
// instead. This script is deliberately narrow: it copies just these two
// packages into apps/mobile/node_modules, wherever npm actually placed them,
// after every install. It never touches anything else in the tree, so it
// can't cause the kind of ripple-effect breakage the broader fixes did.
const fs = require("fs");
const path = require("path");

const PACKAGES = ["expo-image-picker", "expo-image-manipulator"];
const MOBILE_NODE_MODULES = path.resolve(__dirname, "../node_modules");

for (const pkg of PACKAGES) {
  const dest = path.join(MOBILE_NODE_MODULES, pkg);
  if (fs.existsSync(dest)) continue; // already local (e.g. a future npm placed it there itself)

  let resolvedPkgJson;
  try {
    resolvedPkgJson = require.resolve(`${pkg}/package.json`);
  } catch {
    console.warn(`[fix-plugin-resolution] ${pkg} not found in the tree — skipping`);
    continue;
  }

  const src = path.dirname(resolvedPkgJson);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[fix-plugin-resolution] copied ${pkg} -> apps/mobile/node_modules`);
}
