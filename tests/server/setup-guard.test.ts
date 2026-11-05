import { describe, it, expect } from "vitest";

describe("test-environment guard", () => {
  it("has live keys scrubbed and the dev.to override on a closed port", () => {
    expect(process.env.DEVTO_API_KEY).toBeUndefined();
    expect(process.env.DEVTO_API_KEY_TESSERA).toBeUndefined();
    expect(process.env.DEVTO_API_BASE_OVERRIDE).toBe("http://127.0.0.1:1");
    expect(process.env.DOTENV_CONFIG_PATH).toBe("./tests/no-dotenv-here");
  });
});
