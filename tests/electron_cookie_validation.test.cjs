const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCookiesBrowserId } = require("../dist-electron/cookies.js");

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
