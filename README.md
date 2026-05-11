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

## Adding another network later

Implement a publisher under `server/publishers/`, register it in `server/publishers/registry.ts`, document new env vars in `.env.example`, and extend the UI checkboxes + `FormData` flags.

## License

MIT — see [LICENSE](./LICENSE).
