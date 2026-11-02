# Comfy

A self-hosted front end for [ComfyUI](https://github.com/comfyanonymous/ComfyUI): describe a
picture or a clip, get it back in a library. It is an independent project and is not affiliated
with ComfyUI or Comfy Org.

**Status: early development.** The server and the web app (Create, Library, Activity, Workflows, Settings) work end to end.

## How it works

Comfy never lets a browser submit a ComfyUI graph. A **workflow** is a folder with a ComfyUI graph
exported with "Save (API Format)" and a small manifest that lists the few inputs people may change
(the prompt, the size, a seed). Everything else in the graph runs exactly as exported. Users send
`{ workflowId, values }` and the server fills the graph in, runs it on your ComfyUI, stores the
results and streams progress back.

See `workflows/krea2-turbo` for a complete example that uses only core ComfyUI nodes.

## Documentation

- [Configuration and authentication](docs/configuration.md)
- [Workflows and manifests](docs/workflows.md)
- [Deployment: reverse proxy, backups](docs/deployment.md)


## Running the server

Requires **Node 22 or newer** (`.nvmrc` pins it; with nvm, run `nvm use`) and a running ComfyUI. The
server refuses to start on an older Node, because following a job needs its built-in WebSocket.

```
npm install
cp .env.example .env     # then edit COMFYUI_URL if ComfyUI is not on this machine
npm run build
npm --workspace server start
```

In production the server also serves the built web app. For development run `npm run dev` (server) and `npm run dev:web` (Vite on :5173, proxying `/api`).

By default it listens on `127.0.0.1:3000` for one local user. To let other people in, pick an
`AUTH_MODE` in `.env` (see `.env.example`); the server refuses to start with no authentication on
a network address.

## Development

```
npm test        # builds the shared contracts, then runs every test
npm run lint
npm run typecheck
```

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
