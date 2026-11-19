# Quick Acct

Bookkeeping for small businesses. Next.js + Supabase. Rules and commands live in
[CLAUDE.md](CLAUDE.md).

## Run it locally

```bash
npm install
npm run db:start              # local Supabase on ports 583xx (needs Docker)
cp .env.example .env.local    # fill keys from `npm run db:status`
npm run dev                   # http://localhost:3200, sign in with any email;
                              # the link arrives at http://127.0.0.1:58324
```

## Checks

```bash
npm run build      # build + client-bundle secret scan
npm test           # unit tests
npm run test:e2e   # Playwright
```
