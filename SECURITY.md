# Security policy

## Supported versions

Only the **latest commit on the default branch** is supported for security fixes. This is a small local tool; there are no long-term release branches.

## Reporting a vulnerability

Please open a **private** security advisory on GitHub (or email the repository maintainers if GitHub advisories are unavailable). Do not file public issues for undisclosed vulnerabilities.

Include:

- A short description of the impact
- Steps to reproduce (if safe to share)
- Whether you believe the issue requires local access, physical access, or network exposure

## Scope and expectations

This project is designed for **single-user local** use with secrets in `.env`. It is **not** intended to be exposed to the public internet as a multi-tenant service. Reports about missing enterprise hardening when the app is deliberately bound to `127.0.0.1` may be declined as out of scope.

We will do our best to acknowledge reports within a few business days, but there is **no SLA** and no bug bounty program.
