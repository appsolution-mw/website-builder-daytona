import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGitHubAppJwt, normalizePrivateKey } from "../app";

describe("GitHub App helpers", () => {
  it("normalizes escaped PEM newlines", () => {
    expect(normalizePrivateKey("-----BEGIN-----\\nabc\\n-----END-----\\n")).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
  });

  it("creates an RS256 JWT with app id issuer", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    const jwt = createGitHubAppJwt(
      {
        appId: "12345",
        clientId: "client",
        privateKey: pem,
        slug: "wbd-dev",
        webhookSecret: "secret",
      },
      new Date("2026-05-04T00:00:00.000Z"),
    );

    const [header, payload, signature] = jwt.split(".");
    expect(signature).toBeTruthy();
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toMatchObject({
      iss: "12345",
    });
  });
});
