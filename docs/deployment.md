# Deployment

## From source

Requires **Node 22 or newer**. `.nvmrc` pins it (`nvm use`). On an older Node the server exits at
start with a message saying so.

Under systemd, `ExecStart` must name that Node explicitly. A service does not read `.nvmrc`, and
`/usr/bin/node` is often an older system Node. A Node installed with nvm lives in a home
directory, which the unit's `ProtectHome` hides and the service user cannot read, so the service
fails with "No such file or directory". Copy it somewhere shared instead, for example
`cp -r ~/.nvm/versions/node/v22.x.x /opt/node22 && chmod -R a+rX /opt/node22`, and use
`/opt/node22/bin/node`. Run `npm ci` and `npm run build` with the same Node the
service will use.

```
npm install
cp .env.example .env
npm run build
npm --workspace server start
```

Windows, macOS and Linux all work. Set `NODE_ENV=production` so the server hosts the built web app.

## Behind a reverse proxy

Terminate TLS at the proxy and forward to the app. Two things matter:

- **Live updates use Server-Sent Events** (`GET /api/events`). Disable response buffering for that
  path (nginx: `proxy_buffering off;`) and allow long-lived connections. The app sends a heartbeat
  every few seconds, so ordinary idle timeouts are fine.
- **Trust.** With `AUTH_MODE=proxy-header`, list the proxy in `TRUSTED_PROXIES` and strip the
  identity header from client requests. With `AUTH_MODE=token`, serve over HTTPS so the session
  cookie is marked Secure.

## Backups

`npm --workspace server run db:backup` writes a consistent copy of the database into
`DATA_DIR/backups`. Image files live under `DATA_DIR` and can be copied with any file backup tool.

## Cleaning ComfyUI's output folder

Optional: install `comfyui-extension/job_cleanup` into ComfyUI's `custom_nodes` and set
`COMFYUI_CLEANUP_TOKEN` in both places. Finished jobs' files are then removed from ComfyUI once the
app has stored its own copy.
