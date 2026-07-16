import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 1;

export class KeyStore {
  constructor(options = {}) {
    this.file = path.resolve(options.file || process.env.API_KEYS_FILE || "data/api-keys.json");
    this.adminTokenFile = path.resolve(options.adminTokenFile || process.env.ADMIN_TOKEN_FILE || "data/admin-token.txt");
    this.adminToken = process.env.ADMIN_TOKEN || "";
    this.data = { version: STORE_VERSION, keys: [] };
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await mkdir(path.dirname(this.adminTokenFile), { recursive: true });
    await this.#load();
    await this.#ensureAdminToken();
  }

  async #load() {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        version: parsed.version || STORE_VERSION,
        keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.#save();
    }
  }

  async #save() {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  async #ensureAdminToken() {
    if (this.adminToken) return;

    try {
      this.adminToken = (await readFile(this.adminTokenFile, "utf8")).trim();
      if (this.adminToken) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    this.adminToken = `adm_${randomBytes(32).toString("base64url")}`;
    await writeFile(this.adminTokenFile, `${this.adminToken}\n`, { mode: 0o600 });
    console.log(`codex-app-server-api admin token created at ${this.adminTokenFile}`);
  }

  isAdminToken(token) {
    return safeEqual(String(token || ""), this.adminToken);
  }

  listKeys() {
    return this.data.keys
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((key) => publicKeyRecord(key));
  }

  async createKey({ name = "", workspacePath = "" } = {}) {
    const secret = `sk-codex-${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const record = {
      id: `key_${randomBytes(8).toString("hex")}`,
      name: String(name || "API key").trim().slice(0, 120) || "API key",
      key_hash: hashSecret(secret),
      key_preview: previewSecret(secret),
      workspace_path: String(workspacePath || "").trim(),
      created_at: now,
      last_used_at: null,
      revoked_at: null,
    };

    this.data.keys.push(record);
    await this.#save();
    return { ...publicKeyRecord(record), key: secret };
  }

  async revokeKey(id) {
    const key = this.data.keys.find((item) => item.id === id);
    if (!key || key.revoked_at) return null;
    key.revoked_at = new Date().toISOString();
    await this.#save();
    return publicKeyRecord(key);
  }

  async verifyApiKey(secret) {
    if (!secret) return null;
    const hash = hashSecret(secret);
    const key = this.data.keys.find((item) => !item.revoked_at && safeEqual(item.key_hash, hash));
    if (!key) return null;
    key.last_used_at = new Date().toISOString();
    await this.#save();
    return publicKeyRecord(key);
  }
}

function publicKeyRecord(key) {
  return {
    id: key.id,
    name: key.name,
    key_preview: key.key_preview,
    workspace_path: key.workspace_path || "",
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    revoked_at: key.revoked_at,
  };
}

function hashSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

function previewSecret(secret) {
  const value = String(secret);
  return `${value.slice(0, 14)}...${value.slice(-6)}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
