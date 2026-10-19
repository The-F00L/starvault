# Contributing

Thanks for your interest in StarVault. Bug reports, fixes and small features are welcome.

## Before you start

For anything bigger than a bug fix, open an issue first so we can agree on the approach. StarVault deliberately stays small: it never writes to GitHub, never holds a user's token in the browser, and the public site has no database.

## Development

Requires Node 22.13 or later (24 recommended).

```sh
npm install
npm run dev         # app + /api proxy on http://localhost:5173
npm test            # unit and integration tests (Vitest)
npm run typecheck
npm run build
npm run e2e         # end-to-end sync test; needs Google Chrome installed
```

`npm run e2e` builds the app and the self-hosted server, starts it on port 8799 with an empty database, and drives two separate Chrome profiles against it.

## Pull requests

- Add or update tests with each change. Server code lives in `server/`, client sync in `src/lib/remote.ts` and `src/lib/outbox.ts`; both have thorough tests to follow.
- Keep `npm test`, `npm run typecheck` and `npm run build` passing; CI runs them along with the end-to-end test.
- Every user write in `src/lib/collections.ts` and `src/lib/db.ts` must queue its outbox entry in the same Dexie transaction, or self-hosted devices drift apart.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues or PRs.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
