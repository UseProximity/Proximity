// Guards for builds that leave the developer's machine (EAS preview and production).
//
// EXPO_PUBLIC_* values are inlined into the JavaScript bundle when it is built, from
// the build environment and, if present, apps/mobile/.env.local. A build that picks up
// the local development file would ship a LAN address or an insecure URL, so these
// checks fail the build (app.config.js) and, as a second line, the app at startup
// (src/lib/apiClient.js) instead of letting it run with the wrong values.
//
// CommonJS on purpose: app.config.js is loaded by Node, the app bundle by Metro.
// Functions take values as arguments. They never read process.env, because Expo only
// inlines literal `process.env.EXPO_PUBLIC_NAME` expressions, so the call sites do.
// Messages name the variable and the rule, never the value.

const PRIVATE_SUFFIXES = [".local", ".lan", ".internal", ".home", ".localdomain", ".localhost"];

// scheme://host[:port] with no credentials. Hand-written because React Native's URL
// implementation is incomplete.
const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/?#@:]+)(?::\d+)?(?:[/?#]|$)/i;

// Why `value` cannot be the base URL of a distributed build, or null if it can: it
// must be an https URL on a public host name (no IP address, localhost or LAN name).
function publicHttpsUrlProblem(value) {
  if (typeof value !== "string" || !value.trim()) return "is not set";
  const match = URL_PARTS.exec(value.trim());
  if (!match) return "is not a valid URL";
  if (match[1].toLowerCase() !== "https") return "must use https";
  const host = match[2].toLowerCase();
  if (host.startsWith("[") || /^[0-9.]+$/.test(host)) return "must be a host name, not an IP address";
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return "must not point at a local or private network";
  }
  if (!host.includes(".")) return "must be a fully qualified host name";
  return null;
}

// Startup check for the API URL, run by the app itself in non-development builds.
function assertDistributableApiUrl(value) {
  const problem = publicHttpsUrlProblem(value);
  if (problem) {
    throw new Error(
      `EXPO_PUBLIC_API_URL ${problem}. This build was made with the wrong environment; rebuild it with the Expo preview or production environment variables.`
    );
  }
}

// Everything a preview or production build needs, as a list of problems (empty when
// the environment is fit to ship). `env` holds the raw values by their short names.
function distributableEnvProblems(env) {
  const problems = [];
  const add = (name, problem) => problems.push(`${name} ${problem}`);

  const api = publicHttpsUrlProblem(env.apiUrl);
  if (api) add("EXPO_PUBLIC_API_URL", api);

  const supabaseUrl = publicHttpsUrlProblem(env.supabaseUrl);
  if (supabaseUrl) add("EXPO_PUBLIC_SUPABASE_URL", supabaseUrl);

  const key = typeof env.supabaseKey === "string" ? env.supabaseKey.trim() : "";
  if (!key) {
    add("EXPO_PUBLIC_SUPABASE_DEFAULT_KEY", "is not set");
  } else if (key.startsWith("sb_secret_")) {
    add("EXPO_PUBLIC_SUPABASE_DEFAULT_KEY", "is a secret key and must never ship in an app");
  } else if (key.split(".").length === 3) {
    // A legacy JWT key: the service role one is a secret too.
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if (claims.role === "service_role") {
        add("EXPO_PUBLIC_SUPABASE_DEFAULT_KEY", "is a service role key and must never ship in an app");
      }
    } catch {
      // Not a decodable JWT; nothing more to check here.
    }
  }

  for (const [name, value] of [
    ["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", env.googleIosClientId],
    ["EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID", env.googleAndroidClientId],
  ]) {
    if (typeof value !== "string" || !value.trim() || value.trim() === "not-configured") {
      add(name, "is not set");
    }
  }

  const mapbox = typeof env.mapboxToken === "string" ? env.mapboxToken.trim() : "";
  if (!mapbox) add("EXPO_PUBLIC_MAPBOX_TOKEN", "is not set");
  else if (!mapbox.startsWith("pk.")) add("EXPO_PUBLIC_MAPBOX_TOKEN", "must be a public (pk.) token");

  if (typeof env.testEmailTo === "string" && env.testEmailTo.trim()) {
    add("EXPO_PUBLIC_TEST_EMAIL_TO", "must not be set for preview, testflight or production builds");
  }

  return problems;
}

module.exports = { publicHttpsUrlProblem, assertDistributableApiUrl, distributableEnvProblems };
