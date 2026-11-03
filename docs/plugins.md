# Plug-ins

Two parts of the server can be replaced by a small JavaScript module you point at in `.env`:
who is allowed in (`AUTH_MODULE`) and how jobs share the GPU (`GPU_GATE_MODULE`). Each module is
an ES module whose default export is a function returning the object described below. A module
that is missing, unreadable or exports the wrong thing stops the server at start-up with the reason.

The interfaces live in `server/src/auth/types.ts` and `server/src/jobs/gpuGate.ts`.

## Authentication: `AUTH_MODULE`

Set `AUTH_MODE=module` and `AUTH_MODULE=/path/to/provider.js`.

```js
// provider.js
export default function createProvider() {
  return {
    name: "my-sso", // shown in the start-up log
    async authenticate(request) {
      // `request` is Node's IncomingMessage: read headers or cookies, verify a token.
      const user = await verifyTokenFrom(request.headers.authorization);
      // Return { id } for a person you accept, or null for everyone else.
      return user ? { id: user.email } : null;
    },
  };
}
```

- The `id` is an opaque string. Every image, job and setting is stored against it, so keep it
  stable: changing a person's `id` hides their library from them.
- Return `null` for anything you do not accept, and do not say why. Every route answers the same
  `401`, so a caller cannot tell a wrong credential from a missing one.
- A provider that owns a login (a cookie it sets itself) can add `session: { cookieName, login }`.
  `login(credential)` returns the cookie value for a valid credential or `null`; the app then
  answers `POST /api/auth/login` and `POST /api/auth/logout` for it. The built-in `token` mode works
  this way. Providers that identify each request on their own do not need it.
- Verify credentials on every request, or cache results briefly. The app does not cache for you.

## GPU sharing: `GPU_GATE_MODULE`

Jobs run one at a time. By default an in-process gate lines them up first come, first served. If
other software uses the same GPU (a second app, a training run), point `GPU_GATE_MODULE` at a module
that coordinates with it.

```js
// gate.js
export default function createGate() {
  return {
    // Resolve when it is this job's turn. `release()` must be safe to call twice.
    async acquire({ label, signal }) {
      await waitForTurn(label, signal); // reject if `signal` aborts while waiting
      return { release: () => giveBackTurn(label) };
    },
    // Who holds the GPU and who waits; position 0 holds it. Never include users or jobs.
    async status() {
      return [{ app: "comfy", position: 0 }];
    },
  };
}
```

- If `signal` aborts while waiting, reject the `acquire` and drop your place in line.
- `label` is for operators only. Do not show it to other users.
- Always release, including when a job fails or is cancelled. A lease that is never released blocks
  every later job.
