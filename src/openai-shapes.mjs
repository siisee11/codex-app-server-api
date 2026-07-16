import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
  "gpt-5-codex",
];

export function extractPromptFromResponses(body) {
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) return body.input.map(renderInputItem).filter(Boolean).join("\n\n");
  if (Array.isArray(body.messages)) return extractPromptFromMessages(body.messages);
  return body.prompt || body.text || "";
}

export function extractPromptFromChatCompletions(body) {
  return extractPromptFromMessages(body.messages || []);
}

export function extractPromptFromMessages(messages) {
  return messages.map((message) => {
    const role = message.role || "user";
    const text = renderContent(message.content);
    return text ? `${role}: ${text}` : "";
  }).filter(Boolean).join("\n\n");
}

export function renderInputItem(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";

  if (item.type === "message") {
    const role = item.role || "user";
    return `${role}: ${renderContent(item.content)}`;
  }
  if (item.type === "input_text" || item.type === "output_text") return item.text || "";
  if (item.text) return item.text;
  if (item.content) return renderContent(item.content);
  return "";
}

export function renderContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);

  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") return part.text || "";
    if (part.type === "image_url") return `[image: ${part.image_url?.url || ""}]`;
    if (part.type === "input_image") return `[image: ${part.image_url || part.file_id || ""}]`;
    return part.text || "";
  }).filter(Boolean).join("\n");
}

export function responsesResult({ model, outputText, threadId, turn }) {
  const now = Math.floor(Date.now() / 1000);
  const responseId = `resp_${turn?.id || randomId()}`;
  return {
    id: responseId,
    object: "response",
    created_at: now,
    model: model || null,
    status: turn?.status || "completed",
    output: [
      {
        id: `msg_${randomId()}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: [],
          },
        ],
      },
    ],
    output_text: outputText,
    usage: null,
    codex: {
      thread_id: threadId,
      turn_id: turn?.id || null,
      duration_ms: turn?.durationMs ?? null,
    },
  };
}

export function chatCompletionResult({ model, outputText, threadId, turn }) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl_${turn?.id || randomId()}`,
    object: "chat.completion",
    created: now,
    model: model || null,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outputText,
        },
        finish_reason: turn?.status === "completed" ? "stop" : turn?.status || "stop",
      },
    ],
    usage: null,
    codex: {
      thread_id: threadId,
      turn_id: turn?.id || null,
      duration_ms: turn?.durationMs ?? null,
    },
  };
}

export function availableModelIds() {
  if (process.env.CODEX_MODELS) {
    return normalizeModelIds(process.env.CODEX_MODELS.split(","));
  }

  const cached = readCodexModelsCache();
  return cached.length ? cached : DEFAULT_MODEL_IDS;
}

export function modelList(allowedModels = []) {
  const allowed = normalizeModelIds(allowedModels);
  const ids = allowed.length ? expandAllowedModelIds(allowed, availableModelIds()) : availableModelIds();
  return {
    object: "list",
    data: ids.map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "codex-app-server",
    })),
  };
}

export function isModelAllowed(model, allowedModels = []) {
  const allowed = normalizeModelIds(allowedModels);
  if (!allowed.length) return true;
  return allowed.some((pattern) => matchesModelPattern(model, pattern));
}

export function matchesModelPattern(model, pattern) {
  const id = String(model || "");
  const value = String(pattern || "").trim();
  if (!id || !value) return false;
  if (value === "*") return true;
  if (!value.includes("*")) return id === value;
  return isSuffixWildcard(value) && id.startsWith(value.slice(0, -1));
}

export function normalizeModelIds(models = []) {
  const seen = new Set();
  const normalized = [];
  for (const model of Array.isArray(models) ? models : []) {
    const id = String(model || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function expandAllowedModelIds(allowedModels, availableModels) {
  const ids = [];
  for (const allowed of allowedModels) {
    if (isSuffixWildcard(allowed)) {
      ids.push(...availableModels.filter((model) => matchesModelPattern(model, allowed)));
    } else {
      ids.push(allowed);
    }
  }
  return normalizeModelIds(ids);
}

function readCodexModelsCache() {
  try {
    const raw = readFileSync(codexModelsCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    const models = Array.isArray(parsed) ? parsed : parsed?.models;
    if (!Array.isArray(models)) return [];

    return normalizeModelIds(models
      .filter((model) => model && typeof model === "object")
      .filter((model) => model.visibility !== "hide")
      .sort((a, b) => modelPriority(a) - modelPriority(b))
      .map((model) => model.slug || model.id));
  } catch {
    return [];
  }
}

function codexModelsCachePath() {
  if (process.env.CODEX_MODELS_CACHE) return process.env.CODEX_MODELS_CACHE;
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  return path.join(codexHome, "models_cache.json");
}

function isSuffixWildcard(pattern) {
  const value = String(pattern || "");
  const starIndex = value.indexOf("*");
  return starIndex !== -1 && starIndex === value.length - 1 && value.lastIndexOf("*") === starIndex;
}

function modelPriority(model) {
  return Number.isFinite(model?.priority) ? model.priority : Number.MAX_SAFE_INTEGER;
}

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}
