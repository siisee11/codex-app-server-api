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

export function modelList() {
  const ids = (process.env.CODEX_MODELS || "gpt-5.4,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5-codex")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}
