import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../../src/App";

describe("App smoke", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the publish surface", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, devtoIdentities: [] }),
    }));
    render(<App />);
    expect(screen.getByRole("button", { name: /publish now/i })).toBeTruthy();
  });
});
