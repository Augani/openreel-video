import { describe, expect, it } from "vitest";
import { parseHandoff } from "./handoff";

const PK = "sb_publishable_abcdefghijklmnopqrstuvwxyz";

describe("parseHandoff", () => {
  it("reads the one-time code and the public key", () => {
    expect(parseHandoff(`#hk=pkce_abc12345&pk=${PK}`)).toEqual({ tokenHash: "pkce_abc12345", publishableKey: PK });
  });
  it("ignores the editor's own hash routes", () => {
    expect(parseHandoff("#/editor")).toBeNull();
    expect(parseHandoff("#/share/x")).toBeNull();
    expect(parseHandoff("")).toBeNull();
  });
  it("rejects missing or malformed values", () => {
    expect(parseHandoff(`#pk=${PK}`)).toBeNull();
    expect(parseHandoff("#hk=abc12345")).toBeNull();
    expect(parseHandoff(`#hk=a<script>&pk=${PK}`)).toBeNull();
    expect(parseHandoff(`#hk=abc12345&pk=short`)).toBeNull();
  });
});
