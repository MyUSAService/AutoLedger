import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, sha256hex } from "./auth";

describe("password hashing (scrypt)", () => {
  it("verifies the correct password and rejects wrong ones", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a random salt — same password hashes differently", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });

  it("rejects malformed stored hashes without throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});

describe("token hashing", () => {
  it("is deterministic and hex-encoded", () => {
    expect(sha256hex("abc")).toBe(sha256hex("abc"));
    expect(sha256hex("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256hex("abc")).not.toBe(sha256hex("abd"));
  });
});
