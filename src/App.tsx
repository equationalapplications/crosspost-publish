import { useCallback, useMemo, useState } from "react";

type PublishResult = {
  networkId: string;
  ok: boolean;
  message?: string;
  externalId?: string;
};

export default function App() {
  const [text, setText] = useState("");
  const [bluesky, setBluesky] = useState(true);
  const [linkedin, setLinkedin] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PublishResult[] | null>(null);

  const onPickFile = useCallback((f: File | null) => {
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }, []);

  const canPublish = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!bluesky && !linkedin) return false;
    return true;
  }, [text, bluesky, linkedin]);

  const publish = async () => {
    setError(null);
    setResults(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("text", text);
      fd.set("bluesky", bluesky ? "1" : "0");
      fd.set("linkedin", linkedin ? "1" : "0");
      if (file) fd.set("image", file);

      const res = await fetch("/api/publish", { method: "POST", body: fd });
      const data = (await res.json()) as { results?: PublishResult[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResults(data.results ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Crosspost publish</h1>
      <p className="sub">
        Compose once, publish now to Bluesky and LinkedIn (personal). Runs locally;
        secrets stay in <code>.env</code> on the API server.
      </p>

      <div className="card">
        <label className="field" htmlFor="body">
          Post text
        </label>
        <textarea
          id="body"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to share?"
          maxLength={8000}
        />

        <div className="row">
          <label className="field" style={{ marginBottom: 0 }}>
            Optional image (same file to each network)
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <button type="button" className="ghost" onClick={() => onPickFile(null)}>
              Remove image
            </button>
          ) : null}
        </div>
        {previewUrl ? (
          <img className="preview" src={previewUrl} alt="Selected attachment preview" />
        ) : null}

        <div className="row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={bluesky}
              onChange={(e) => setBluesky(e.target.checked)}
            />
            Bluesky
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={linkedin}
              onChange={(e) => setLinkedin(e.target.checked)}
            />
            LinkedIn (personal)
          </label>
        </div>

        <div className="actions">
          <button type="button" className="primary" disabled={!canPublish || busy} onClick={publish}>
            {busy ? "Publishing…" : "Publish now"}
          </button>
        </div>
      </div>

      {error ? <div className="err-banner">{error}</div> : null}

      {results?.length ? (
        <div className="results card">
          <h2>Results</h2>
          {results.map((r) => (
            <div key={r.networkId} className="result">
              <span className={`badge ${r.ok ? "ok" : "err"}`}>{r.ok ? "OK" : "Error"}</span>
              <span>
                <strong>{r.networkId}</strong>
                {r.message ? ` — ${r.message}` : ""}
                {r.externalId ? (
                  <>
                    {" "}
                    <span style={{ color: "var(--muted)" }}>({r.externalId})</span>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
