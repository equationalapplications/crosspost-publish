# Crosspost publish

Local web app to compose a post once and publish **immediately** to **Bluesky** and **LinkedIn** (personal profile). Optional **one image** per post. Each network reports success or failure independently.

**Stack:** React (Vite) UI + small Node (Express) API. No Next.js. Intended for a **public MIT** repo: copy `.env.example` to `.env` and keep secrets out of git.

## Threat model (read this)

This tool is for **single-user local use**. It is **not** hardened as a public internet service. Run the API bound to **localhost** (`127.0.0.1` by default). Do not expose `API_PORT` to untrusted networks without additional controls.

## Prerequisites

- Node.js **20+** (uses global `fetch` / `Headers`).
- Bluesky account with an **App Password**.
- LinkedIn Developer app with **Community Management / share** access and a **member** access token with permission to post as yourself (`w_member_social`). Token acquisition and rotation are **manual in v1**; refresh tokens are not implemented here.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_PORT` | No | API listen port (default `3001`). |
| `BLUESKY_HANDLE` | For Bluesky | Your handle (e.g. `you.bsky.social`). |
| `BLUESKY_APP_PASSWORD` | For Bluesky | App password (not your account password). |
| `BLUESKY_SERVICE` | No | PDS URL (default `https://bsky.social`). |
| `LINKEDIN_PERSON_URN` | For LinkedIn | `urn:li:person:…` for your profile. |
| `LINKEDIN_ACCESS_TOKEN` | For LinkedIn | OAuth access token with post scope. |

Copy `.env.example` to `.env` and fill in values. **Never commit `.env`.**

## Git (SSH)

Upstream: [equationalapplications/crosspost-publish](https://github.com/equationalapplications/crosspost-publish) on GitHub. Use **SSH** for `git clone` and `git push`:

```bash
git clone git@github.com:equationalapplications/crosspost-publish.git
cd crosspost-publish
```

If `origin` is already set to HTTPS, switch it to SSH:

```bash
git remote set-url origin git@github.com:equationalapplications/crosspost-publish.git
git push -u origin main
```

Add an SSH key to your GitHub account and confirm access with `ssh -T git@github.com` before pushing.

## LinkedIn image flow (API `202405`)

For posts **with an image**, the API server runs the same three steps Microsoft documents for UGC images:

1. **`POST https://api.linkedin.com/v2/assets?action=registerUpload`** — JSON body includes `registerUploadRequest` with `recipes`, `owner` (`urn:li:person:…`), and `serviceRelationships`. Response yields `uploadUrl` and `urn:li:digitalmediaAsset:…`.
2. **`PUT` the file bytes** to `uploadUrl` with headers **`Authorization: Bearer …`**, **`Content-Type: application/octet-stream`**, **`Linkedin-Version: 202405`**, and **`X-Restli-Protocol-Version: 2.0.0`**.
3. **`POST https://api.linkedin.com/v2/ugcPosts`** — `shareMediaCategory: IMAGE` and `media: [{ status: "READY", media: "<asset URN>" }]`.

Between steps 2 and 3, the server **polls** `GET https://api.linkedin.com/rest/assets/{assetId}?fields=recipes,id` until a `recipes[]` entry has **`status: AVAILABLE`**, or (if that GET is not usable) waits **~1.5s** before creating the UGC post. Very large assets may still need a longer wait or manual retry.

## Run locally (development)

Two processes: Vite on **5173** (proxies `/api` → API) and the API on **3001**.

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Open `http://localhost:5173`.

## Production-style local run (single process)

Build the client and server, then start the API (it serves `dist/client` when present):

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3001` (or whatever `API_PORT` is).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite + API with hot reload (`tsx watch`). |
| `npm run build` | `vite build` + compile `server/` to `dist/server`. |
| `npm start` | Run compiled API from `dist/server`. |
| `npm run lint` | ESLint. |
| `npm run linkedin:post` | CLI wrapper; pass args after `--` (see below). |

## Standalone LinkedIn CLI (Node only)

`scripts/linkedin-ugc-post.mjs` is a **zero-extra-package** Node 20+ script that runs the same **202405** UGC flow as the server (text-only or text + one image). From the repo root, load `.env` with Node’s built-in module hook (uses the repo’s `dotenv` dependency):

```bash
# text only
node --import dotenv/config scripts/linkedin-ugc-post.mjs "Hello from the CLI"

# text + image
node --import dotenv/config scripts/linkedin-ugc-post.mjs "Photo day" ./photo.jpg
```

Or via npm (note the `--` before script arguments):

```bash
npm run linkedin:post -- "Hello from npm" ./photo.jpg
```

If you prefer not to use `dotenv`, set `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_PERSON_URN` in the shell, or use `node --env-file=.env` (Node 20+) when you keep secrets in `.env`.

## Adding another network later

Implement a publisher under `server/publishers/`, register it in `server/publishers/registry.ts`, document new env vars in `.env.example`, and extend the UI checkboxes + `FormData` flags.

## License

MIT — see [LICENSE](./LICENSE).
