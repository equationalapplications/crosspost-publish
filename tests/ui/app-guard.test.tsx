import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import App from "../../src/App";

afterEach(cleanup); // vitest runs without globals:true, so RTL auto-cleanup never registers

function healthThen(payload: unknown) {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
    .mockResolvedValueOnce(payload);
}

const created = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", externalId: "42", url: "https://dev.to/x" }] }) };
const unknownRow = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "unknown", message: "may exist" }] }) };
const rejectedRow = { ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "rejected", message: "422" }] }) };

async function fillArticleForm() {
  fireEvent.change(screen.getByLabelText(/post title/i), { target: { value: "T" } });
  fireEvent.change(screen.getByLabelText(/article body/i), { target: { value: "B" } });
}

async function checkDevto() {
  const box = screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement;
  await waitFor(() => expect(box.disabled).toBe(false)); // devtoReady — fail-closed until health resolves
  fireEvent.click(box);
  return box;
}

describe("dev.to submit-time lock", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it("locks dev.to at submit before the response arrives, clears on created", async () => {
    const f = healthThen(created);
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBe("pending:kurt"); // default identity rides in the flag
    expect((screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement).disabled).toBe(true);
    await screen.findByText("https://dev.to/x"); // the created row links the article url
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull();
  });

  it("stays locked after an unknown outcome until the confirmation is ticked", async () => {
    const f = healthThen(unknownRow);
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => screen.getByLabelText(/checked .+dev\.to account/i));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBe("pending:kurt");
    fireEvent.click(screen.getByLabelText(/checked .+dev\.to account/i));
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull();
  });

  it("unlocks automatically on a deterministic rejection", async () => {
    const f = healthThen(rejectedRow);
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull());
  });

  it("survives a reload: re-mount with the pending flag keeps the lock", async () => {
    sessionStorage.setItem("crosspost.devtoPending", "pending:kurt");
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    const devtoBox = screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement;
    expect(devtoBox.disabled).toBe(true);
    expect(devtoBox.checked).toBe(true); // spec rule 6: locked checkbox renders checked
    await waitFor(() => screen.getByLabelText(/checked .+dev\.to account/i));
  });

  it("an unlocked combined dev.to+Bluesky submit carries both targets in one JSON body", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [
        { networkId: "devto", ok: true, resultKind: "created", url: "https://dev.to/x" },
        { networkId: "bluesky", ok: false, message: "not configured" },
      ] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    fireEvent.change(screen.getByLabelText(/post text/i), { target: { value: "short post" } });
    // Bluesky is checked by default — leave it that way
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await screen.findByText("https://dev.to/x"); // devto row renders
    const init = f.mock.calls[1]?.[1] as RequestInit;
    const parsed = JSON.parse(init.body as string);
    expect(parsed.devto).toBe(true);
    expect(parsed.bluesky).toBe(true);
    expect(parsed.text).toBe("short post");
    expect(parsed.article.title).toBe("T");
  });

  it("a Kurt-only submit (single configured identity) works without a manual selector", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", url: "https://dev.to/x" }] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement).disabled).toBe(false)); // devtoReady
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await screen.findByText("https://dev.to/x");
    const parsed = JSON.parse((f.mock.calls[1]?.[1] as RequestInit).body as string) as { devtoIdentity?: string | null };
    // never serialize null: null would 400 the day-one single-key configuration
    expect(parsed.devtoIdentity === undefined || parsed.devtoIdentity === "kurt").toBe(true);
    expect(screen.queryByLabelText(/publish as/i)).toBeNull(); // selector hidden for a single identity
  });

  it("blocks the dev.to submit until health resolves — no unnamed lock (fail closed)", async () => {
    let resolveHealth: (v: unknown) => void = () => {};
    const f = vi.fn()
      .mockReturnValueOnce(new Promise((res) => { resolveHealth = res; })) // health hangs
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", url: "https://dev.to/x" }] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    const devtoBox = screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement;
    expect(devtoBox.disabled).toBe(true); // identities unknown → dev.to disabled
    fireEvent.click(devtoBox);
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    // dev.to must NOT go out unnamed: no publish call happened at all (bluesky not selected)
    expect(f).toHaveBeenCalledTimes(1); // only the health call
    expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull();
    resolveHealth({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt"] }) });
  });

  it("health failure keeps dev.to disabled with a retry message", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("health down"));
    vi.stubGlobal("fetch", f);
    render(<App />);
    await waitFor(() => screen.getByText(/dev\.to unavailable — retry/i));
    expect((screen.getByRole("checkbox", { name: /^dev\.to$/i }) as HTMLInputElement).disabled).toBe(true);
  });

  it("re-enables the image picker while dev.to is locked (Bluesky/LinkedIn keep images)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "unknown", message: "may exist" }] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    expect((screen.getByLabelText(/optional image/i) as HTMLInputElement).disabled).toBe(true); // targeted, not locked
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => screen.getByLabelText(/checked .+dev\.to account/i));
    expect((screen.getByLabelText(/optional image/i) as HTMLInputElement).disabled).toBe(false); // locked → dev.to cannot go out → image usable
  });

  it("shows the identity selector when more than one identity is configured", async () => {
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    await waitFor(() => screen.getByLabelText(/publish as/i));
    await checkDevto();
    const select = screen.getByLabelText(/publish as/i) as HTMLSelectElement;
    expect(select.value).toBe("kurt"); // default = first identity
    fireEvent.change(select, { target: { value: "tessera" } });
    expect((select as HTMLSelectElement).value).toBe("tessera");
  });

  it("disables the image picker when dev.to is checked", async () => {
    vi.stubGlobal("fetch", healthThen(created));
    render(<App />);
    await checkDevto();
    expect((screen.getByLabelText(/optional image/i) as HTMLInputElement).disabled).toBe(true);
  });

  it("never includes dev.to in a payload submitted while locked (other targets ride alone)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: false, resultKind: "unknown", message: "may exist" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ networkId: "bluesky", ok: false, message: "not configured" }] }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => screen.getByLabelText(/checked .+dev\.to account/i));
    // now fill the short-form text and submit again with Bluesky alongside the locked dev.to
    fireEvent.change(screen.getByLabelText(/post text/i), { target: { value: "short post" } });
    fireEvent.click(screen.getByLabelText(/bluesky/i));
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(3));
    // call 0 = health, call 1 = first publish (JSON, contains article), call 2 = locked submit:
    const lockedInit = f.mock.calls[2]?.[1] as RequestInit;
    const lockedBody = lockedInit.body as FormData;
    expect(lockedInit.headers && (lockedInit.headers as Record<string, string>)["content-type"]).toBeUndefined(); // FormData path, not JSON
    expect(lockedBody.get("devto")).toBeNull();
    expect(lockedBody.get("title")).toBeNull();
    expect(lockedBody.get("bodyMarkdown")).toBeNull();
    expect(lockedBody.get("text")).toBe("short post");
  });

  it("a double-click sends exactly one devto request", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockReturnValueOnce(new Promise((res) => { resolveFirst = res; })); // first publish hangs until we resolve it
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    const publish = screen.getByRole("button", { name: /publish now/i });
    fireEvent.click(publish);
    fireEvent.click(publish); // second click while in flight
    resolveFirst({ ok: true, json: async () => ({ results: [{ networkId: "devto", ok: true, resultKind: "created", url: "https://dev.to/x" }] }) });
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2)); // health + ONE publish only
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/api/publish")).length).toBe(1);
  });

  it("unlocks on a deterministic 4xx response with no result rows", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, devtoIdentities: ["kurt", "tessera"] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "dev.to does not support images in v1" }) });
    vi.stubGlobal("fetch", f);
    render(<App />);
    await checkDevto();
    await fillArticleForm();
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));
    await waitFor(() => expect(sessionStorage.getItem("crosspost.devtoPending")).toBeNull());
  });
});
