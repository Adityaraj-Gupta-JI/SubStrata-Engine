import { test } from "node:test";
import assert from "node:assert/strict";
import { clerkConfigurationIssues } from "../src/lib/auth/configuration.ts";

const configured = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
  CLERK_SECRET_KEY: "sk_test_fixture",
};

test("accepts structurally valid keys without claiming they authenticate", () => {
  assert.deepEqual(clerkConfigurationIssues(configured), []);
});

test("identifies a non-ByteString secret before Clerk constructs request headers", () => {
  const result = clerkConfigurationIssues({ ...configured, CLERK_SECRET_KEY: "sk_test_fixture\u2026" });
  assert.deepEqual(result, [{ name: "CLERK_SECRET_KEY", reason: "unicode_ellipsis" }]);
  assert.ok(!JSON.stringify(result).includes("fixture"));
  assert.throws(() => new Headers({ Authorization: "Bearer sk_test_fixture\u2026" }), TypeError);
});

test("rejects missing, whitespace, and malformed keys without echoing them", () => {
  assert.equal(clerkConfigurationIssues({}).length, 2);
  assert.deepEqual(clerkConfigurationIssues({ ...configured, CLERK_SECRET_KEY: "sk_test_fixture\n" }), [{ name: "CLERK_SECRET_KEY", reason: "invalid_characters" }]);
  assert.deepEqual(clerkConfigurationIssues({ ...configured, CLERK_SECRET_KEY: "wrong-prefix" }), [{ name: "CLERK_SECRET_KEY", reason: "invalid_format" }]);
});
