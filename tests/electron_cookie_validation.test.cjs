const test = require("node:test");
const assert = require("node:assert/strict");

const { cookieSourceFromBrowserId, validateCookieSource, validateCookiesBrowserId } = require("../dist-electron/cookies.js");

const browsers = [
  { id: "chrome", label: "Chrome", appPath: "/Applications/Google Chrome.app" },
  { id: "safari", label: "Safari", appPath: "/Applications/Safari.app" },
];

test("validateCookiesBrowserId accepts null", () => {
  assert.equal(validateCookiesBrowserId(null, browsers), null);
});

test("validateCookiesBrowserId accepts detected browser ids", () => {
  assert.equal(validateCookiesBrowserId("chrome", browsers), "chrome");
});

test("validateCookiesBrowserId rejects arbitrary renderer input", () => {
  assert.throws(() => validateCookiesBrowserId("../../../cookies.txt", browsers), /Unsupported browser selection/);
});

test("cookieSourceFromBrowserId normalizes off and browser sources", () => {
  assert.deepEqual(cookieSourceFromBrowserId(null, browsers), { mode: "off" });
  assert.deepEqual(cookieSourceFromBrowserId("safari", browsers), { mode: "browser", browserId: "safari" });
});

test("validateCookieSource accepts only structured supported sources", () => {
  assert.deepEqual(validateCookieSource({ mode: "off" }, browsers), { mode: "off" });
  assert.deepEqual(validateCookieSource({ mode: "browser", browserId: "chrome" }, browsers), { mode: "browser", browserId: "chrome" });
  assert.throws(() => validateCookieSource({ mode: "browser", browserId: "../../../cookies.txt" }, browsers), /Unsupported browser selection/);
  assert.throws(() => validateCookieSource("chrome", browsers), /Unsupported cookie source/);
});
