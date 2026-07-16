# codex-app-server-api

HTTP/OpenAI-compatible wrapper around the local `codex app-server`.

This project does not reimplement Codex. It starts a local `codex app-server`
process over stdio, initializes the JSON-RPC session, starts or resumes a Codex
thread, starts one turn, and returns the assistant text as OpenAI-style HTTP
responses.

## Endpoints

- `GET /healthz`
- `GET /admin`
- `GET /admin/api/keys`
- `POST /admin/api/keys`
- `PATCH /admin/api/keys/:id`
- `DELETE /admin/api/keys/:id`
- `GET /v1/models`
- `GET /models`
- `GET /backend-api/codex/models`
- `POST /v1/responses`
- `POST /responses`
- `POST /backend-api/codex/responses`
- `POST /v1/chat/completions`
- `POST /chat/completions`

Each generation request can set the workspace with any of:

- JSON body: `cwd`, `workspace_path`, `workspacePath`, or `workspace`
- Header: `X-Workspace-Path`
- Environment fallback: `CODEX_DEFAULT_WORKSPACE`

The workspace path must be an existing absolute directory. Set
`CODEX_WORKSPACE_ROOTS=/Users/dev/git,/tmp/safe-workspaces` to restrict allowed
workspaces.

## Run

```bash
npm start
```

Optional environment variables:

```bash
HOST=127.0.0.1
PORT=8787
CODEX_BIN=codex
CODEX_MODEL=gpt-5.4
CODEX_DEFAULT_WORKSPACE=/Users/dev/git/sub2api
CODEX_WORKSPACE_ROOTS=/Users/dev/git
API_BEARER_TOKEN=change-me
CODEX_TURN_TIMEOUT_MS=900000
CODEX_MODELS=gpt-5.4,gpt-5.3-codex,gpt-5-codex
```

If `API_BEARER_TOKEN` is set, pass `Authorization: Bearer <token>`.

## API Keys

Open `http://127.0.0.1:8787/admin` to issue API keys from the local web UI,
then open `http://127.0.0.1:8787/settings` to set a key's workspace scope.
The admin token is read from `ADMIN_TOKEN` or generated at `data/admin-token.txt`
on first start. API key records are stored in `data/api-keys.json`; only SHA-256
hashes are persisted, so the full key is shown once when it is created.

By default generation endpoints require an issued API key:

```bash
curl http://127.0.0.1:8787/v1/responses \
  -H 'authorization: Bearer sk-codex-...' \
  -H 'content-type: application/json' \
  -d '{"input":"Say OK"}'
```

Set `DISABLE_API_KEY_AUTH=true` to allow unauthenticated local calls.

## Cloudflare Edge Deployment

This repository also includes a Wrangler Worker that fronts the local origin
server through Cloudflare Tunnel:

- API: `https://codex-app-server-api.wordbricks.ai`
- Admin: `https://codex-app-server-admin.wordbricks.ai`
- Tunnel origin: `https://codex-app-server-origin.wordbricks.ai`

The API host requires an API key on every real request. Accepted headers follow
the same order as sub2api: `Authorization: Bearer ...`, then `x-api-key`, then
`x-goog-api-key`.

The admin host serves a separate `/login` page at the edge and sets a signed
HttpOnly session cookie after a successful login. Local credentials are stored in:

```text
data/cloudflare-admin-credentials.txt
```

The Worker forwards admin API calls to the origin with `ORIGIN_ADMIN_TOKEN`,
which is stored as a Wrangler secret and sourced locally from `data/admin-token.txt`.

Deploy:

```bash
wrangler deploy
```

Required Wrangler secrets:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_SESSION_SECRET
ORIGIN_ADMIN_TOKEN
```

## Responses API Example

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "workspace_path": "/Users/dev/git/sub2api",
    "input": "Summarize this repository in five bullets.",
    "stream": true
  }'
```

## Chat Completions Example

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "cwd": "/Users/dev/git/sub2api",
    "messages": [
      {"role": "user", "content": "What language is this repository mostly written in?"}
    ]
  }'
```

## Codex Options

The wrapper forwards these optional request fields into `thread/start` or
`turn/start` where supported by your installed Codex version:

- `thread_id` / `threadId` / `codex.thread_id`
- `approval_policy` / `approvalPolicy`
- `sandbox`
- `sandbox_policy` / `sandboxPolicy`
- `service_tier` / `serviceTier`
- `reasoning.effort` / `effort`
- `reasoning.summary` / `summary`
- `codex_config` / `config`

The first implementation starts one `codex app-server` process per HTTP request.
That keeps workspace/thread state isolated and easy to debug. A future pool mode
can reuse app-server processes if latency becomes the bottleneck.
