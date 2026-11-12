// Run with `npm test` inside apps/mobile (Node's built-in test runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const { distributableEnvProblems } = require("../envGuard");

const IOS_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const ANDROID_ID = "123456789012-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com";

// A complete, valid environment. Each test changes one value.
function validEnv(overrides = {}) {
  return {
    apiUrl: "https://api.example.com",
    supabaseUrl: "https://project.supabase.co",
    supabaseKey: "sb_publishable_abc",
    googleIosClientId: IOS_ID,
    googleAndroidClientId: ANDROID_ID,
    mapboxToken: "pk.abc",
    testEmailTo: "",
    ...overrides,
  };
}

test("a complete environment has no problems", () => {
  assert.deepEqual(distributableEnvProblems(validEnv()), []);
});

test("both Google client IDs must be set", () => {
  for (const [key, name] of [
    ["googleIosClientId", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"],
    ["googleAndroidClientId", "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"],
  ]) {
    for (const value of [undefined, "", "   ", "not-configured"]) {
      assert.deepEqual(distributableEnvProblems(validEnv({ [key]: value })), [`${name} is not set`]);
    }
  }
});

test("a placeholder that is not a Google client ID is rejected", () => {
  const bad = [
    "pending",
    "placeholder",
    "123456789012.apps.googleusercontent.com",
    "abc-def.apps.googleusercontent.com",
    "123456789012-abcdef.apps.example.com",
    "123456789012-abcdef.apps.googleusercontent.com.evil.com",
    "https://123456789012-abcdef.apps.googleusercontent.com",
  ];
  for (const value of bad) {
    const problems = distributableEnvProblems(validEnv({ googleIosClientId: value }));
    assert.equal(problems.length, 1, `expected one problem for ${value}`);
    assert.match(problems[0], /^EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not a Google client ID/);

    const androidProblems = distributableEnvProblems(validEnv({ googleAndroidClientId: value }));
    assert.equal(androidProblems.length, 1, `expected one problem for ${value}`);
    assert.match(androidProblems[0], /^EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is not a Google client ID/);
  }
});

test("surrounding whitespace is ignored", () => {
  assert.deepEqual(
    distributableEnvProblems(validEnv({ googleIosClientId: `  ${IOS_ID}\n`, googleAndroidClientId: ` ${ANDROID_ID} ` })),
    []
  );
});

test("problem messages never contain the value", () => {
  const secretLooking = "super-secret-placeholder";
  const problems = distributableEnvProblems(validEnv({ googleIosClientId: secretLooking }));
  assert.equal(problems.length, 1);
  assert.ok(!problems[0].includes(secretLooking));
});
