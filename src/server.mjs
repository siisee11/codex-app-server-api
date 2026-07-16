import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { adminHtml } from "./admin-ui.mjs";
import { runCodexTurn } from "./codex-app-server-client.mjs";
import { KeyStore } from "./key-store.mjs";
import {
  availableModelIds,
  chatCompletionResult,
  extractPromptFromChatCompletions,
  extractPromptFromResponses,
  modelList,
  normalizeModelIds,
  responsesResult,
} from "./openai-shapes.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 4 * 1024 * 1024);
const DEFAULT_WORKSPACE = expandPath(process.env.CODEX_DEFAULT_WORKSPACE || process.cwd());
const WORKSPACE_ROOTS = (process.env.CODEX_WORKSPACE_ROOTS || "")
  .split(",")
  .map((value) => expandPath(value.trim()))
  .filter(Boolean);
const API_AUTH_REQUIRED = process.env.DISABLE_API_KEY_AUTH !== "true";

const keyStore = new KeyStore();
await keyStore.init();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = normalizePathname(url.pathname);

    if (req.method === "OPTIONS") {
      return sendEmpty(res, 204);
    }

    if (req.method === "GET" && (pathname === "/healthz" || pathname === "/readyz")) {
      return sendJson(res, 200, { ok: true, codex: process.env.CODEX_BIN || "codex" });
    }

    if (req.method === "GET" && isAdminPagePath(pathname)) {
      return sendHtml(res, 200, adminHtml({
        authRequired: API_AUTH_REQUIRED,
        defaultWorkspace: DEFAULT_WORKSPACE,
        workspaceRoots: WORKSPACE_ROOTS,
      }));
    }

    if (pathname.startsWith("/admin/api/")) {
      return await handleAdminApi(req, res, pathname);
    }

    if (API_AUTH_REQUIRED && !(await isAuthorized(req))) {
      return sendJson(res, 401, {
        error: {
          type: "authentication_error",
          message: "API key is required. Create one at /admin and pass Authorization: Bearer <key>.",
        },
      });
    }

    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models" || pathname === "/backend-api/codex/models")) {
      return sendJson(res, 200, modelList(req.apiKey?.allowed_models));
    }

    if (req.method === "POST" && isResponsesPath(pathname)) {
      const body = await readJson(req);
      return await handleResponses(req, res, body);
    }

    if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
      const body = await readJson(req);
      return await handleChatCompletions(req, res, body);
    }

    sendJson(res, 404, { error: { type: "not_found_error", message: `No route for ${req.method} ${pathname}` } });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: {
        type: error.type || "api_error",
        message: error.message || "Internal server error",
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`codex-app-server-api listening on http://${HOST}:${PORT}`);
});

async function handleAdminApi(req, res, pathname) {
  if (!isAdmin(req)) {
    return sendJson(res, 401, { error: { type: "authentication_error", message: "Invalid admin token" } });
  }

  if (req.method === "GET" && pathname === "/admin/api/keys") {
    return sendJson(res, 200, { keys: keyStore.listKeys() });
  }

  if (req.method === "GET" && pathname === "/admin/api/models") {
    return sendJson(res, 200, { models: availableModelIds() });
  }

  if (req.method === "POST" && pathname === "/admin/api/keys") {
    const body = await readJson(req);
    const rawWorkspace = body.workspace_path || body.workspacePath || "";
    const workspace = rawWorkspace ? validateWorkspace(rawWorkspace) : "";
    const key = await keyStore.createKey({
      name: body.name,
      workspacePath: workspace,
    });
    return sendJson(res, 201, key);
  }

  if ((req.method === "PATCH" || req.method === "PUT") && pathname.startsWith("/admin/api/keys/")) {
    const id = decodeURIComponent(pathname.slice("/admin/api/keys/".length));
    const body = await readJson(req);
    const updates = {};
    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.workspace_path !== undefined || body.workspacePath !== undefined) {
      const rawWorkspace = body.workspace_path ?? body.workspacePath ?? "";
      updates.workspacePath = rawWorkspace ? validateWorkspace(rawWorkspace) : "";
    }
    if (body.allowed_models !== undefined || body.allowedModels !== undefined) {
      updates.allowedModels = normalizeModelIds(body.allowed_models ?? body.allowedModels ?? []);
    }

    const updated = await keyStore.updateKey(id, updates);
    if (!updated) {
      return sendJson(res, 404, { error: { type: "not_found_error", message: "API key not found" } });
    }
    return sendJson(res, 200, updated);
  }

  if (req.method === "DELETE" && pathname.startsWith("/admin/api/keys/")) {
    const id = decodeURIComponent(pathname.slice("/admin/api/keys/".length));
    const revoked = await keyStore.revokeKey(id);
    if (!revoked) {
      return sendJson(res, 404, { error: { type: "not_found_error", message: "API key not found" } });
    }
    return sendJson(res, 200, revoked);
  }

  return sendJson(res, 404, { error: { type: "not_found_error", message: `No admin route for ${req.method} ${pathname}` } });
}

async function handleResponses(req, res, body) {
  const workspace = resolveWorkspace(req, body);
  const model = resolveModel(req, body);
  const prompt = extractPromptFromResponses(body);
  if (!prompt.trim()) {
    return sendJson(res, 400, { error: { type: "invalid_request_error", message: "input, messages, prompt, or text is required" } });
  }

  const runOptions = codexRunOptions(req, body, workspace, model, prompt);

  if (body.stream) {
    return streamResponses(req, res, runOptions, model);
  }

  const result = await runCodexTurn(runOptions);
  sendJson(res, 200, responsesResult({ model, ...result }));
}

async function handleChatCompletions(req, res, body) {
  const workspace = resolveWorkspace(req, body);
  const model = resolveModel(req, body);
  const prompt = extractPromptFromChatCompletions(body);
  if (!prompt.trim()) {
    return sendJson(res, 400, { error: { type: "invalid_request_error", message: "messages is required" } });
  }

  const runOptions = codexRunOptions(req, body, workspace, model, prompt);

  if (body.stream) {
    return streamChatCompletions(req, res, runOptions, model);
  }

  const result = await runCodexTurn(runOptions);
  sendJson(res, 200, chatCompletionResult({ model, ...result }));
}

function codexRunOptions(req, body, cwd, model, prompt) {
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  return {
    cwd,
    model,
    prompt,
    threadId: body.thread_id || body.threadId || body.codex?.thread_id,
    approvalPolicy: body.approval_policy || body.approvalPolicy,
    sandbox: body.sandbox,
    sandboxPolicy: body.sandbox_policy || body.sandboxPolicy,
    serviceTier: body.service_tier || body.serviceTier,
    effort: body.reasoning?.effort || body.effort,
    summary: body.reasoning?.summary || body.summary,
    config: body.codex_config || body.config,
    signal: abort.signal,
  };
}

async function streamResponses(req, res, runOptions, model) {
  prepareSse(res);
  const responseId = `resp_${Date.now().toString(36)}`;
  writeSse(res, "response.created", {
    type: "response.created",
    response: { id: responseId, object: "response", created_at: Math.floor(Date.now() / 1000), model, status: "in_progress" },
  });

  try {
    const result = await runCodexTurn({
      ...runOptions,
      onDelta: (delta) => {
        writeSse(res, "response.output_text.delta", {
          type: "response.output_text.delta",
          response_id: responseId,
          delta,
        });
      },
    });
    writeSse(res, "response.completed", {
      type: "response.completed",
      response: responsesResult({ model, ...result, outputText: result.outputText }),
    });
    res.write("data: [DONE]\n\n");
  } catch (error) {
    writeSse(res, "error", { type: "error", error: { message: error.message } });
  } finally {
    res.end();
  }
}

async function streamChatCompletions(req, res, runOptions, model) {
  prepareSse(res);
  const id = `chatcmpl_${Date.now().toString(36)}`;

  try {
    await runCodexTurn({
      ...runOptions,
      onDelta: (delta) => {
        writeSse(res, null, {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        });
      },
    });
    writeSse(res, null, {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
  } catch (error) {
    writeSse(res, "error", { error: { message: error.message } });
  } finally {
    res.end();
  }
}

function isResponsesPath(pathname) {
  return pathname === "/v1/responses" ||
    pathname === "/responses" ||
    pathname === "/backend-api/codex/responses";
}

function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

function isAdminPagePath(pathname) {
  return pathname === "/" ||
    pathname === "/admin" ||
    pathname === "/settings" ||
    pathname === "/admin/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/admin/settings/");
}

function resolveModel(req, body) {
  const model = body.model || process.env.CODEX_MODEL || undefined;
  assertModelAllowed(req, model);
  return model;
}

function assertModelAllowed(req, model) {
  const allowedModels = normalizeModelIds(req.apiKey?.allowed_models);
  if (!allowedModels.length) return;

  if (!model) {
    throw Object.assign(new Error("model is required for this API key"), {
      statusCode: 400,
      type: "invalid_request_error",
    });
  }

  if (!allowedModels.includes(String(model))) {
    throw Object.assign(new Error(`model ${model} is not allowed for this API key`), {
      statusCode: 403,
      type: "permission_error",
    });
  }
}

function resolveWorkspace(req, body) {
  const requestedWorkspace = body.cwd ||
    body.workspace_path ||
    body.workspacePath ||
    body.workspace ||
    req.headers["x-workspace-path"] ||
    "";
  const keyWorkspace = req.apiKey?.workspace_path || "";

  if (req.apiKey && !keyWorkspace && requestedWorkspace) {
    throw Object.assign(new Error("workspace path is not configured for this API key"), {
      statusCode: 403,
      type: "permission_error",
    });
  }

  const raw = requestedWorkspace ||
    keyWorkspace ||
    req.apiKey?.workspace_path ||
    DEFAULT_WORKSPACE;
  const workspace = validateWorkspace(raw);
  if (keyWorkspace) {
    const scope = validateWorkspace(keyWorkspace);
    if (workspace !== scope && !workspace.startsWith(`${scope}${path.sep}`)) {
      throw Object.assign(new Error("workspace path is outside this API key scope"), {
        statusCode: 403,
        type: "permission_error",
      });
    }
  }
  return workspace;
}

function validateWorkspace(raw) {
  const workspace = expandPath(String(raw));
  if (!path.isAbsolute(workspace)) {
    throw badRequest("workspace path must be absolute");
  }
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw badRequest(`workspace path does not exist or is not a directory: ${workspace}`);
  }
  if (WORKSPACE_ROOTS.length > 0) {
    const allowed = WORKSPACE_ROOTS.some((root) => workspace === root || workspace.startsWith(`${root}${path.sep}`));
    if (!allowed) {
      throw Object.assign(new Error("workspace path is outside CODEX_WORKSPACE_ROOTS"), {
        statusCode: 403,
        type: "permission_error",
      });
    }
  }
  return workspace;
}

function expandPath(value) {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

async function isAuthorized(req) {
  const token = process.env.API_BEARER_TOKEN;
  const requestToken = bearerToken(req) || headerToken(req);
  if (token && requestToken === token) return true;
  const apiKey = await keyStore.verifyApiKey(requestToken);
  if (!apiKey) return false;
  req.apiKey = apiKey;
  return true;
}

function isAdmin(req) {
  return keyStore.isAdminToken(req.headers["x-admin-token"] || bearerToken(req));
}

function bearerToken(req) {
  const value = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : "";
}

function headerToken(req) {
  return String(req.headers["x-api-key"] || req.headers["x-goog-api-key"] || "").trim();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("request body too large"), { statusCode: 413, type: "invalid_request_error" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(badRequest("request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function prepareSse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
}

function writeSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-api-key,x-goog-api-key,x-workspace-path,x-admin-token",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-api-key,x-goog-api-key,x-workspace-path,x-admin-token",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end();
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400, type: "invalid_request_error" });
}

export const serverUrl = pathToFileURL(import.meta.url).href;
