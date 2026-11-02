# Configuration

Settings come from environment variables. The server reads a `.env` file in the repository root
(copy `.env.example`); relative paths in it are resolved against that folder. Real environment
variables win over the file.

| Variable                | Default                 | Meaning                                                                                                          |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `HOST`                  | `127.0.0.1`             | Address to listen on. Loopback keeps the app private to this machine.                                            |
| `PORT`                  | `3000`                  | Port to listen on.                                                                                               |
| `COMFYUI_URL`           | `http://127.0.0.1:8188` | Your ComfyUI. Server-side only; never sent to a browser.                                                         |
| `DATA_DIR`              | `./data`                | Database, images, thumbnails and backups.                                                                        |
| `WORKFLOWS_DIR`         | `./workflows`           | Folder of workflow folders (see [workflows](workflows.md)).                                                      |
| `ALLOW_NSFW_WORKFLOWS`  | `true`                  | Workflows marked `nsfw` are hidden for everyone when `false`.                                                    |
| `COMFYUI_CLEANUP_TOKEN` | unset                   | Enables deleting finished jobs' files from ComfyUI; needs the `job_cleanup` extension from `comfyui-extension/`. |
| `GPU_GATE_MODULE`       | unset                   | A file exporting a GPU gate factory, to share one GPU with other software. Default is an in-process gate.        |

## Authentication

Choose one with `AUTH_MODE`. Every mode fails closed: a request with no identity gets `401`.

| Mode           | Use when                                                                                                               | Settings                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `none`         | One person on one machine. The server refuses to start on a non-loopback `HOST` unless `AUTH_NONE_ALLOW_NETWORK=true`. | —                                                                                                                   |
| `token`        | A few people, no reverse proxy. People sign in once with their token (an HttpOnly cookie is set).                      | `AUTH_TOKENS=alice=<16+ chars>,bob=<16+ chars>`                                                                     |
| `proxy-header` | A reverse proxy you control authenticates people and sets a header.                                                    | `AUTH_HEADER` (default `x-forwarded-user`), `TRUSTED_PROXIES` (peer addresses allowed to set it; default loopback)  |
| `module`       | Anything else, e.g. a single sign-on provider.                                                                         | `AUTH_MODULE=/path/to/provider.js`, whose default export builds an `AuthProvider` (see `server/src/auth/types.ts`). |

Behind `proxy-header`, make sure the proxy strips the header from incoming requests and that the
app is only reachable through the proxy.
