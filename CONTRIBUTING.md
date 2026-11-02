# Contributing

Thanks for helping. Keep changes small and focused.

```
npm install
npm run lint && npm run typecheck && npm test
```

All three must pass. `npm run format` fixes formatting. For the UI run `npm run dev` (server) and
`npm run dev:web` (Vite) together.

- Follow the patterns in the code you touch. Features live in `web/src/features/<name>`; the server
  is organised by area (`routes`, `jobs`, `images`, `workflows`, ...).
- Add or update tests with the change. Server tests use a fake ComfyUI; no GPU is needed.
- Keep private details (addresses, names of your own deployment, personal prompts or models) out of
  the repository. `node scripts/scrub.mjs` checks this and runs in CI.
- Never let a browser submit a ComfyUI graph or a node id; users send `{ workflowId, values }` only.

## Sign-off

Certify the [Developer Certificate of Origin](https://developercertificate.org/) by signing each
commit: `git commit -s`. By contributing you agree your work is licensed under Apache-2.0.
