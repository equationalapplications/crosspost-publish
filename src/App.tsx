import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PublishResult = {
  networkId: string;
  ok: boolean;
  message?: string;
  externalId?: string;
  resultKind?: string;
  url?: string;
};

const DEVTO_PENDING_KEY = "crosspost.devtoPending";

export default function App() {
  const [text, setText] = useState("");
  const [bluesky, setBluesky] = useState(true);
  const [linkedin, setLinkedin] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PublishResult[] | null>(null);

  // dev.to state
  const [devto, setDevto] = useState(false);
  const [devtoIdentity, setDevtoIdentity] = useState<string | null>(null);
  const [identities, setIdentities] = useState<string[]>([]);
  const [devtoReady, setDevtoReady] = useState(false);
  const [devtoHealthError, setDevtoHealthError] = useState(false);
  const [devtoLocked, setDevtoLocked] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(DEVTO_PENDING_KEY);
    if (stored) {
      setDevtoLocked(true);
      setPendingIdentity(stored.startsWith("pending:") ? stored.slice("pending:".length) : stored);
    }
    let cancelled = false;
    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) throw new Error(`health ${res.status}`);
        const data = (await res.json()) as { devtoIdentities?: string[] };
        if (cancelled) return;
        const ids = Array.isArray(data.devtoIdentities) ? data.devtoIdentities : [];
        setIdentities(ids);
        setDevtoReady(true);
        setDevtoIdentity((prev) => (prev === null && ids.length > 0 ? ids[0] : prev));
      })
      .catch(() => {
        if (cancelled) return;
        setIdentities([]);
        setDevtoReady(false);
        setDevtoHealthError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPickFile = useCallback(
    (f: File | null) => {
      setFile(f);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return f ? URL.createObjectURL(f) : null;
      });
    },
    []
  );

  const resetForm = useCallback(() => {
    setText("");
    setTitle("");
    setBodyMarkdown("");
    setCanonicalUrl("");
    setDescription("");
    setTags("");
    onPickFile(null);
    setResults(null);
    setError(null);
    // NOTE: never touches crosspost.devtoPending or the confirmation requirement
  }, [onPickFile]);

  const identityLabel = pendingIdentity ? pendingIdentity : null;

  const confirmDevto = useCallback(() => {
    sessionStorage.removeItem(DEVTO_PENDING_KEY);
    setPendingIdentity(null);
    setDevtoLocked(false);
  }, []);

  const canPublish = useMemo(() => {
    if (devto) {
      if (!title.trim() || !bodyMarkdown.trim()) return false;
    } else {
      const trimmed = text.trim();
      if (!trimmed) return false;
    }
    if (!bluesky && !linkedin && !devto) return false;
    if (devtoLocked && !bluesky && !linkedin) return false;
    if (busy) return false;
    return true;
  }, [text, title, bodyMarkdown, bluesky, linkedin, devto, devtoLocked, busy]);

  const publish = async () => {
    if (submitting.current) return; // double-click guard: ref is synchronous
    if (devto && !devtoReady && !devtoLocked) return; // fail closed: identities unknown → nothing goes out
    submitting.current = true;
    setError(null);
    setResults(null);
    setBusy(true);
    try {
      const devtoTarget = devto && !devtoLocked;
      if (devtoTarget) {
        // Set the lock BEFORE the fetch: unknown outcome starts at submit, not at response.
        const identity = devtoIdentity ?? null;
        sessionStorage.setItem(DEVTO_PENDING_KEY, `pending:${identity ?? "none"}`);
        setPendingIdentity(identity ?? "none");
        setDevtoLocked(true);
        const article: {
          title: string;
          bodyMarkdown: string;
          canonicalUrl?: string;
          description?: string;
          tags?: string[];
        } = {
          title: title.trim(),
          bodyMarkdown,
        };
        if (canonicalUrl.trim()) article.canonicalUrl = canonicalUrl.trim();
        if (description.trim()) article.description = description.trim();
        const tagList = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (tagList.length > 0) article.tags = tagList.slice(0, 4);
        const payload: Record<string, unknown> = {
          text: text.trim() ? text : undefined,
          bluesky,
          linkedin,
          devto: true,
          article,
        };
        if (devtoIdentity !== null) payload.devtoIdentity = devtoIdentity; // never serialize null
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // deterministic 4xx (validation, 413, unknown identity): nothing was created
          sessionStorage.removeItem(DEVTO_PENDING_KEY);
          setPendingIdentity(null);
          setDevtoLocked(false);
          let errMsg = `Request failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) errMsg = data.error;
          } catch {
            /* unparseable 4xx still unlocks (deterministic status) */
          }
          setError(errMsg);
          return;
        }
        let data: { results?: PublishResult[]; error?: string };
        try {
          data = (await res.json()) as { results?: PublishResult[]; error?: string };
        } catch {
          // unparseable 2xx (e.g. proxy HTML) is an unknown outcome — keep the lock
          setError("dev.to outcome unknown — verify before re-posting");
          return;
        }
        if (!res.ok) {
          setError(data.error ?? `Request failed (${res.status})`);
          return;
        }
        const rows = data.results ?? [];
        setResults(rows);
        const devtoRow = rows.find((r) => r.networkId === "devto");
        const kind = devtoRow?.resultKind;
        if (devtoRow && (kind === "created" || kind === "rejected")) {
          sessionStorage.removeItem(DEVTO_PENDING_KEY);
          setPendingIdentity(null);
          setDevtoLocked(false);
        } else {
          // unknown outcome / missing row / unrecognized resultKind: keep the lock
          setError("dev.to outcome unknown — verify before re-posting");
        }
        return;
      }

      // Existing FormData path (no dev.to riding along, ever)
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
      // network error on a dev.to submit: keep the lock (unknown outcome)
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
      submitting.current = false;
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

        {devto ? (
          <fieldset disabled={devtoLocked}>
            <label className="field" htmlFor="title">
              Post title
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={128}
              placeholder="Article title"
            />

            <label className="field" htmlFor="article-body">
              Article body
            </label>
            <textarea
              id="article-body"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              maxLength={400000}
              placeholder="Markdown body"
            />

            <label className="field" htmlFor="canonical-url">
              Canonical URL
            </label>
            <input
              id="canonical-url"
              value={canonicalUrl}
              onChange={(e) => setCanonicalUrl(e.target.value)}
              placeholder="https://your-site.example/original-post (apex host only)"
            />

            <label className="field" htmlFor="description">
              Description (~140 chars max; currently {description.length})
            </label>
            <input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
            />

            <label className="field" htmlFor="tags">
              Tags (comma-separated, up to 4)
            </label>
            <input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="javascript, webdev"
            />
          </fieldset>
        ) : null}

        {identities.length > 1 ? (
          <>
            <label className="field" htmlFor="devto-identity">
              publish as
            </label>
            <select
              id="devto-identity"
              value={devtoIdentity ?? ""}
              onChange={(e) => setDevtoIdentity(e.target.value)}
            >
              {identities.map((id) => (
                <option key={id} value={id}>
                  {id === "kurt" ? "Kurt" : id === "tessera" ? "Tessera" : id}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <div className="row">
          <label className="field" htmlFor="image" style={{ marginBottom: 0 }}>
            Optional image (same file to each network)
          </label>
          <input
            id="image"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            disabled={devto && !devtoLocked}
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
          <label className="toggle">
            <input
              type="checkbox"
              checked={devto || devtoLocked}
              disabled={!devtoReady || devtoLocked}
              onChange={(e) => {
                setDevto(e.target.checked);
                if (e.target.checked) onPickFile(null);
              }}
            />
            dev.to
          </label>
        </div>

        {devtoHealthError ? <div className="err-banner">dev.to unavailable — retry</div> : null}

        {devtoLocked ? (
          <div className="row">
            <label className="toggle">
              <input type="checkbox" checked={false} onChange={confirmDevto} />
              {identityLabel && identityLabel !== "none"
                ? `I checked ${identityLabel.charAt(0).toUpperCase()}${identityLabel.slice(1)}'s dev.to account — no duplicate article`
                : "I checked the dev.to account — no duplicate article"}
            </label>
          </div>
        ) : null}

        <div className="actions">
          <button type="button" className="primary" disabled={!canPublish} onClick={publish}>
            {busy ? "Publishing…" : "Publish now"}
          </button>
          <button type="button" className="ghost" onClick={resetForm}>
            Reset
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
                {r.url ? (
                  <>
                    {" "}
                    <a href={r.url}>{r.url}</a>
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
