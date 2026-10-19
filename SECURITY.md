# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue for them.

Include what you found, how to reproduce it, and what an attacker could do with it. You should get a first reply within a week.

## What's in scope

- The public app and its `/api` proxy (`server/proxy.ts`, `worker/index.ts`): anything that lets someone write through the proxy, read private data, get the token echoed back, or reach routes outside the allow-list.
- Share links (`src/lib/share.ts`) and README rendering: script injection, or links that leak data to a server.
- The self-hosted server (`server/selfhost.ts`): the bind refusal, the Host allow-list, static file containment, and cross-site writes to `/api/sync`.

## By design

- A self-hosted instance has **no login**. Anyone who can reach it can read and change the catalog. It's meant to stay on a private network such as a tailnet; exposing it publicly is a misconfiguration, not a vulnerability.
- The public proxy's token can only read public GitHub data. Using up its hourly quota is limited by the safeguards in the README, not prevented outright.
