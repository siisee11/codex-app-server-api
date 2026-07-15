import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class CodexAppServerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.codexCommand = options.codexCommand || process.env.CODEX_BIN || "codex";
    this.cwd = options.cwd || process.cwd();
    this.extraArgs = options.extraArgs || [];
    this.startTimeoutMs = options.startTimeoutMs || DEFAULT_START_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.stdoutBuffer = "";
    this.proc = null;
  }

  start() {
    if (this.proc) return;

    this.proc = spawn(this.codexCommand, ["app-server", "--listen", "stdio://", ...this.extraArgs], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk;
      let newline;
      while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (line) this.#handleLine(line);
      }
    });

    this.proc.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-16_384);
      this.emit("stderr", chunk);
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited code=${code ?? "null"} signal=${signal ?? "null"}${this.stderr ? ` stderr=${this.stderr}` : ""}`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
  }

  async initialize() {
    this.start();
    await this.request("initialize", {
      clientInfo: {
        name: "codex_app_server_api",
        title: "Codex App Server API",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    }, this.startTimeoutMs);
    this.notify("initialized", {});
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("codex app-server is not running");
    }

    const id = this.nextId++;
    const message = { method, id, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.#write(message);
    });
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  close() {
    if (!this.proc) return;
    try {
      this.proc.stdin.end();
    } catch {
      // ignore shutdown races
    }
    setTimeout(() => {
      if (this.proc && !this.proc.killed) {
        this.proc.kill("SIGTERM");
      }
    }, 250).unref();
  }

  #write(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", { error, line });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || `codex app-server error for ${pending.method}`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.#handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.emit("notification", message);
      this.emit(message.method, message.params || {});
    }
  }

  #handleServerRequest(message) {
    const { id, method } = message;
    const deny = (reason) => {
      this.#write({ id, error: { code: -32000, message: reason } });
    };

    switch (method) {
      case "item/commandExecution/requestApproval":
        this.#write({ id, result: { decision: "decline" } });
        return;
      case "item/fileChange/requestApproval":
        this.#write({ id, result: { decision: "decline" } });
        return;
      case "execCommandApproval":
      case "applyPatchApproval":
        this.#write({ id, result: { decision: "denied" } });
        return;
      case "item/tool/requestUserInput":
        this.#write({ id, result: { answers: {} } });
        return;
      case "mcpServer/elicitation/request":
        this.#write({ id, result: { action: "decline", content: null, _meta: null } });
        return;
      default:
        deny(`Server request method is not supported by this HTTP wrapper: ${method}`);
    }
  }
}

export async function runCodexTurn(options) {
  const {
    cwd,
    model,
    prompt,
    threadId,
    approvalPolicy,
    sandbox,
    sandboxPolicy,
    serviceTier,
    effort,
    summary,
    config,
    timeoutMs = Number(process.env.CODEX_TURN_TIMEOUT_MS || 15 * 60_000),
    onNotification,
    onDelta,
    signal,
  } = options;

  const client = new CodexAppServerClient({
    cwd,
    requestTimeoutMs: timeoutMs,
  });

  let outputText = "";
  let turn = null;
  let resolvedThreadId = threadId || null;
  let completed = false;

  const waitForCompletion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Codex turn timed out")), timeoutMs);
    const abort = () => reject(new Error("Request aborted"));
    if (signal) {
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
    }

    client.on("notification", (message) => {
      onNotification?.(message);

      if (message.method === "thread/started" && message.params?.thread?.id) {
        resolvedThreadId = message.params.thread.id;
      }

      if (message.method === "item/agentMessage/delta") {
        const delta = message.params?.delta || "";
        outputText += delta;
        onDelta?.(delta, message);
      }

      if (message.method === "turn/completed") {
        if (resolvedThreadId && message.params?.threadId && message.params.threadId !== resolvedThreadId) {
          return;
        }
        completed = true;
        turn = message.params?.turn || null;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", abort);
        resolve();
      }
    });
  });

  try {
    await client.initialize();

    let threadResponse;
    if (threadId) {
      threadResponse = await client.request("thread/resume", { threadId, cwd });
    } else {
      threadResponse = await client.request("thread/start", compactObject({
        model,
        cwd,
        approvalPolicy,
        sandbox,
        serviceTier,
        config,
        ephemeral: true,
        serviceName: "codex-app-server-api",
      }));
    }
    resolvedThreadId = threadResponse?.thread?.id || resolvedThreadId;

    const turnParams = compactObject({
      threadId: resolvedThreadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd,
      model,
      serviceTier,
      effort,
      summary,
      sandboxPolicy,
    });

    await client.request("turn/start", turnParams);
    await waitForCompletion;

    if (!completed) {
      throw new Error("Codex turn ended before completion notification");
    }

    if (turn?.status === "failed") {
      const error = new Error(turn.error?.message || "Codex turn failed");
      error.turn = turn;
      throw error;
    }

    return {
      outputText,
      threadId: resolvedThreadId,
      turn,
    };
  } finally {
    client.close();
  }
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}
