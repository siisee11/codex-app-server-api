# codex-app-server-api

HTTP/OpenAI-compatible wrapper around the local `codex app-server`.

This project does not reimplement Codex. It starts a local `codex app-server`
process over stdio, initializes the JSON-RPC session, starts or resumes a Codex
thread, starts one turn, and returns the assistant text as OpenAI-style HTTP
responses.

## Endpoints

- `GET /healthz`
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
