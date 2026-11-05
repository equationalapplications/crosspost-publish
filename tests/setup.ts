// Fail loud, never post for real: no live dev.to keys in the test process, and any
// unstubbed devto request hits a closed port instead of dev.to.
// DOTENV_CONFIG_PATH first: server/index.ts imports "dotenv/config", which would
// otherwise REFILL the keys we delete here from the developer's real .env
// (dotenv reads this variable in env-options.js — verified 2026-11-04).
process.env.DOTENV_CONFIG_PATH = "./tests/no-dotenv-here"; // nonexistent path
delete process.env.DEVTO_API_KEY;
delete process.env.DEVTO_API_KEY_TESSERA;
process.env.DEVTO_API_BASE_OVERRIDE = "http://127.0.0.1:1"; // closed port
