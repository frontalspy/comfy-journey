# Deployment

## From source

Requires Node 22 or newer.

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
