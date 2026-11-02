# Security

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab)
rather than a public issue. Include what you found and how to reproduce it. You will get an
acknowledgement within a few days.

## Threat model

- **Users never submit graphs.** A request is `{ workflowId, values }`. Values are validated
  against the workflow's manifest and written into fixed node inputs; the rest of the graph is
  trusted, administrator-supplied configuration.
- **The ComfyUI address is server-side configuration only.** No request can change which host the
  server contacts, which closes off server-side request forgery.
- **Every `/api` route needs an identity** (`AUTH_MODE`), checked before the body is read, and every
  image and job lookup is scoped to its owner. Someone else's id answers like a missing one.
- **Uploads** are size-capped, type-checked by content, rate-limited and capped per person.
- **Output names** from ComfyUI are checked for path traversal before anything is stored.
- **Sessions** use an HttpOnly, SameSite=Lax cookie, marked Secure over HTTPS.

Out of scope: a malicious administrator, and workflow graphs you choose to install (they run
arbitrary ComfyUI nodes, so install only graphs and custom nodes you trust).
