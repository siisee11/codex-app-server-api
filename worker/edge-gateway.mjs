const API_AUTH_MESSAGE = "API key is required. Pass Authorization: Bearer <key>, x-api-key, or x-goog-api-key.";
const ADMIN_SESSION_COOKIE = "codex_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return emptyResponse(204);
      }

      if (url.hostname === env.ADMIN_HOST) {
        return handleAdminRequest(request, env);
      }

      if (url.hostname === env.API_HOST) {
        return handleApiRequest(request, env);
      }

      return jsonResponse({ error: { type: "not_found_error", message: "Unknown host" } }, 404);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: error?.message || "Unhandled error",
        stack: error?.stack,
      }));
      return jsonResponse({ error: { type: "api_error", message: "Internal edge gateway error" } }, 500);
    }
  },
};

async function handleAdminRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/login") {
    if (await isSessionAuthorized(request, env)) {
      return redirectResponse(sanitizeNextPath(url.searchParams.get("next") || "/"), 302);
    }
    return htmlResponse(loginHtml(env, {
      next: sanitizeNextPath(url.searchParams.get("next") || "/"),
    }));
  }

  if (request.method === "POST" && url.pathname === "/login") {
    return handleAdminLogin(request, env);
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/logout") {
    return redirectResponse("/login", 303, clearSessionCookie());
  }

  if (!(await isAdminAuthorized(request, env))) {
    return adminUnauthorizedResponse(request);
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
    return htmlResponse(adminHtml(env));
  }

  if (url.pathname.startsWith("/admin/api/")) {
    return proxyAdminApi(request, env);
  }

  if (url.pathname === "/healthz" || url.pathname === "/readyz") {
    return proxyToOrigin(request, env, { stripAuthorization: true, admin: true });
  }

  return jsonResponse({ error: { type: "not_found_error", message: "Admin route not found" } }, 404);
}

async function handleAdminLogin(request, env) {
  const credentials = await readLoginCredentials(request);
  const [usernameOk, passwordOk] = await Promise.all([
    timingSafeStringEqual(credentials.username, env.ADMIN_USERNAME || ""),
    timingSafeStringEqual(credentials.password, env.ADMIN_PASSWORD || ""),
  ]);

  if (!usernameOk || !passwordOk) {
    if (credentials.wantsJson) {
      return jsonResponse({ error: { type: "authentication_error", message: "Invalid username or password" } }, 401);
    }

    return htmlResponse(loginHtml(env, {
      error: "Invalid username or password.",
      username: credentials.username,
      next: credentials.next,
    }), 401);
  }

  const cookie = await createSessionCookie(credentials.username, env);
  if (credentials.wantsJson) {
    return jsonResponse({ ok: true }, 200, { "set-cookie": cookie });
  }

  return redirectResponse(credentials.next, 303, cookie);
}

async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return jsonResponse({ error: { type: "not_found_error", message: "Admin UI is served on the admin host" } }, 404);
  }

  if (!extractApiKey(request)) {
    return jsonResponse({ error: { type: "authentication_error", message: API_AUTH_MESSAGE } }, 401);
  }

  return proxyToOrigin(request, env);
}

function proxyAdminApi(request, env) {
  return proxyToOrigin(request, env, { stripAuthorization: true, admin: true });
}

async function proxyToOrigin(request, env, options = {}) {
  const target = originUrl(request, env);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", "https");

  if (options.stripAuthorization) {
    headers.delete("authorization");
  }

  if (options.admin) {
    headers.set("x-admin-token", env.ORIGIN_ADMIN_TOKEN);
  }

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("access-control-allow-headers", "authorization,content-type,x-api-key,x-goog-api-key,x-workspace-path");
  responseHeaders.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  responseHeaders.set("x-codex-edge-gateway", "1");

  if (options.admin) {
    responseHeaders.set("cache-control", "no-store");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function originUrl(request, env) {
  const incoming = new URL(request.url);
  const target = new URL(env.ORIGIN_BASE_URL);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  return target.toString();
}

function extractApiKey(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match?.[1]?.trim()) return match[1].trim();

  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey?.trim()) return xApiKey.trim();

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey?.trim()) return googleApiKey.trim();

  return "";
}

async function isBasicAuthorized(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Basic\s+(.+)$/i.exec(authorization);
  if (!match) return false;

  let decoded = "";
  try {
    decoded = atob(match[1]);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  const usernameOk = await timingSafeStringEqual(username, env.ADMIN_USERNAME || "");
  const passwordOk = await timingSafeStringEqual(password, env.ADMIN_PASSWORD || "");
  return usernameOk && passwordOk;
}

async function isAdminAuthorized(request, env) {
  if (await isSessionAuthorized(request, env)) {
    return true;
  }
  return isBasicAuthorized(request, env);
}

async function isSessionAuthorized(request, env) {
  const cookie = readCookie(request, ADMIN_SESSION_COOKIE);
  if (!cookie) return false;

  const separator = cookie.indexOf(".");
  if (separator <= 0) return false;

  const payloadPart = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  const expected = await signSessionPayload(payloadPart, env);
  if (!(await timingSafeStringEqual(signature, expected))) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return false;
  }

  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  return timingSafeStringEqual(String(payload?.u || ""), env.ADMIN_USERNAME || "");
}

async function createSessionCookie(username, env) {
  const payload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signSessionPayload(payloadPart, env);
  return `${ADMIN_SESSION_COOKIE}=${payloadPart}.${signature}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function signSessionPayload(payloadPart, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  return base64UrlEncode(new Uint8Array(signature));
}

function sessionSecret(env) {
  const secret = env.ADMIN_SESSION_SECRET || "";
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured");
  }
  return secret;
}

async function readLoginCredentials(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      username: String(body.username || body.email || ""),
      password: String(body.password || ""),
      next: sanitizeNextPath(body.next || "/"),
      wantsJson: true,
    };
  }

  const params = new URLSearchParams(await request.text());
  return {
    username: String(params.get("username") || params.get("email") || ""),
    password: String(params.get("password") || ""),
    next: sanitizeNextPath(params.get("next") || "/"),
    wantsJson: false,
  };
}

async function timingSafeStringEqual(left, right) {
  const [leftDigest, rightDigest] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    diff |= leftDigest[index] ^ rightDigest[index];
  }
  return diff === 0;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: corsHeaders(),
  });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

function htmlResponse(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

function redirectResponse(location, status = 302, cookie) {
  return new Response(null, {
    status,
    headers: {
      location,
      "cache-control": "no-store",
      ...(cookie ? { "set-cookie": cookie } : {}),
      ...securityHeaders(),
    },
  });
}

function adminUnauthorizedResponse(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/admin/api/") || acceptsJson(request)) {
    return jsonResponse({ error: { type: "authentication_error", message: "Admin login required" } }, 401);
  }

  const next = encodeURIComponent(`${url.pathname}${url.search}`);
  return redirectResponse(`/login?next=${next}`, 302);
}

function acceptsJson(request) {
  return (request.headers.get("accept") || "").includes("application/json");
}

function sanitizeNextPath(value) {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//") || /[\r\n]/.test(next)) {
    return "/";
  }
  return next;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=");
    }
  }
  return "";
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-api-key,x-goog-api-key,x-workspace-path",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  };
}

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function loginHtml(env, options = {}) {
  const next = sanitizeNextPath(options.next || "/");
  const error = options.error || "";
  const username = options.username || "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex App Server Admin Login</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #f7f8fb 0%, #eef2f7 48%, #f8faf9 100%);
      color: #15171c;
    }
    main {
      width: min(420px, calc(100vw - 32px));
      padding: 28px 0;
    }
    section {
      background: rgba(255, 255, 255, .92);
      border: 1px solid #dfe4eb;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 18px 48px rgba(22, 28, 45, .10);
    }
    .brand {
      text-align: center;
      margin-bottom: 24px;
    }
    .mark {
      width: 56px;
      height: 56px;
      margin: 0 auto 14px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: #15171c;
      color: #fff;
      font-weight: 760;
      letter-spacing: 0;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #626b7a;
      font-size: 14px;
    }
    form {
      display: grid;
      gap: 14px;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 650;
      color: #343842;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8d0dc;
      border-radius: 6px;
      padding: 11px 12px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    input:focus {
      outline: 2px solid #9fc0ff;
      outline-offset: 1px;
      border-color: #5f8fe8;
    }
    button {
      margin-top: 4px;
      border: 1px solid #15171c;
      background: #15171c;
      color: #fff;
      border-radius: 6px;
      padding: 11px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      min-height: 20px;
      color: #9f1d1d;
      font-size: 14px;
    }
    .meta {
      margin-top: 16px;
      text-align: center;
      overflow-wrap: anywhere;
    }
    @media (prefers-color-scheme: dark) {
      body {
        background: linear-gradient(135deg, #101318 0%, #151923 52%, #111713 100%);
        color: #edf1f7;
      }
      section {
        background: rgba(24, 28, 35, .94);
        border-color: #303744;
        box-shadow: 0 18px 48px rgba(0, 0, 0, .35);
      }
      label {
        color: #d9dee8;
      }
      p {
        color: #a7b0bf;
      }
      input {
        background: #11151b;
        border-color: #3a4352;
      }
      .mark {
        background: #edf1f7;
        color: #111318;
      }
    }
  </style>
</head>
<body>
  <main>
    <section>
      <div class="brand">
        <div class="mark">CA</div>
        <h1>Codex App Server Admin</h1>
        <p>Sign in to manage API keys.</p>
      </div>
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <div>
          <label for="username">Username</label>
          <input id="username" name="username" value="${escapeHtml(username)}" autocomplete="username" required autofocus>
        </div>
        <div>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <div class="error">${escapeHtml(error)}</div>
        <button type="submit">Sign in</button>
      </form>
      <p class="meta">${escapeHtml(env.ADMIN_HOST)}</p>
    </section>
  </main>
</body>
</html>`;
}

function adminHtml(env) {
  const apiExample = `curl https://${env.API_HOST}/v1/responses \\
  -H 'authorization: Bearer sk-codex-...' \\
  -H 'content-type: application/json' \\
  -d '{"model":"gpt-5.4","workspace_path":"/Users/dev/git/sub2api","input":"Summarize this repo."}'`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex App Server Admin</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    body {
      margin: 0;
      background: #f5f7fa;
      color: #16181d;
    }
    main {
      width: min(1040px, calc(100vw - 32px));
      margin: 30px auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #596170;
    }
    section {
      background: #fff;
      border: 1px solid #dfe4eb;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 650;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8d0dc;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    button {
      border: 1px solid #17191f;
      background: #17191f;
      color: #fff;
      border-radius: 6px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
      white-space: nowrap;
    }
    button.secondary {
      background: #fff;
      color: #17191f;
      border-color: #c8d0dc;
    }
    button.danger {
      background: #9f1d1d;
      border-color: #9f1d1d;
    }
    .headerActions {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 12px;
      align-items: end;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      border-bottom: 1px solid #e8ebf0;
      text-align: left;
      padding: 10px 8px;
      vertical-align: top;
    }
    th {
      color: #667085;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    pre {
      margin: 12px 0 0;
      overflow: auto;
      background: #101216;
      color: #f5f7fa;
      padding: 14px;
      border-radius: 6px;
    }
    .muted {
      color: #667085;
      font-size: 13px;
    }
    .notice {
      display: none;
      background: #edf5ff;
      border-color: #b8d3ff;
    }
    .error {
      min-height: 20px;
      margin-top: 8px;
      color: #9f1d1d;
      font-size: 14px;
    }
    @media (max-width: 760px) {
      header, .grid {
        display: block;
      }
      .grid > div, .grid > button {
        margin-top: 12px;
      }
      table {
        display: block;
        overflow-x: auto;
      }
    }
    @media (prefers-color-scheme: dark) {
      body {
        background: #101319;
        color: #edf1f7;
      }
      section, input, button.secondary {
        background: #181c23;
        border-color: #303744;
      }
      p, .muted, th {
        color: #a7b0bf;
      }
      input, button.secondary {
        color: #edf1f7;
      }
      .notice {
        background: #13243c;
        border-color: #2b508a;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex App Server Admin</h1>
        <p>Issue API keys for the Codex app-server API edge gateway.</p>
      </div>
      <div class="headerActions">
        <div class="muted">
          <div>API host: <code>${escapeHtml(env.API_HOST)}</code></div>
          <div>Origin: <code>${escapeHtml(env.ORIGIN_BASE_URL)}</code></div>
        </div>
        <form method="post" action="/logout">
          <button class="secondary" type="submit">Logout</button>
        </form>
      </div>
    </header>

    <section>
      <h2>Create API Key</h2>
      <div class="grid">
        <div>
          <label for="keyName">Name</label>
          <input id="keyName" placeholder="production key">
        </div>
        <div>
          <label for="workspacePath">Workspace path</label>
          <input id="workspacePath" value="/Users/dev/git/sub2api">
        </div>
        <button id="createKey">Create key</button>
      </div>
      <div id="createError" class="error"></div>
    </section>

    <section id="newKeyNotice" class="notice">
      <h2>New Key</h2>
      <p>Copy this value now. Only the origin server stores a hash after creation.</p>
      <pre id="newKey"></pre>
      <button id="copyKey" class="secondary" style="margin-top: 10px">Copy</button>
    </section>

    <section>
      <h2>Issued Keys</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Key</th>
            <th>Workspace</th>
            <th>Created</th>
            <th>Last used</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="keysBody"></tbody>
      </table>
      <div id="listError" class="error"></div>
    </section>

    <section>
      <h2>Example</h2>
      <pre>${escapeHtml(apiExample)}</pre>
    </section>
  </main>

  <script>
    const els = {
      keyName: document.getElementById("keyName"),
      workspacePath: document.getElementById("workspacePath"),
      createKey: document.getElementById("createKey"),
      newKeyNotice: document.getElementById("newKeyNotice"),
      newKey: document.getElementById("newKey"),
      copyKey: document.getElementById("copyKey"),
      keysBody: document.getElementById("keysBody"),
      createError: document.getElementById("createError"),
      listError: document.getElementById("listError"),
    };

    els.createKey.addEventListener("click", createKey);
    els.copyKey.addEventListener("click", () => navigator.clipboard.writeText(els.newKey.textContent));

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Request failed");
      return data;
    }

    async function createKey() {
      els.createError.textContent = "";
      try {
        const data = await api("/admin/api/keys", {
          method: "POST",
          body: JSON.stringify({
            name: els.keyName.value,
            workspace_path: els.workspacePath.value,
          }),
        });
        els.newKey.textContent = data.key;
        els.newKeyNotice.style.display = "block";
        await loadKeys();
      } catch (error) {
        els.createError.textContent = error.message;
      }
    }

    async function loadKeys() {
      els.listError.textContent = "";
      try {
        const data = await api("/admin/api/keys");
        renderKeys(data.keys || []);
      } catch (error) {
        els.listError.textContent = error.message;
      }
    }

    async function revokeKey(id) {
      await api("/admin/api/keys/" + encodeURIComponent(id), { method: "DELETE" });
      await loadKeys();
    }

    function renderKeys(keys) {
      if (!keys.length) {
        els.keysBody.innerHTML = '<tr><td colspan="6" class="muted">No keys yet.</td></tr>';
        return;
      }
      els.keysBody.innerHTML = "";
      for (const key of keys) {
        const tr = document.createElement("tr");
        tr.innerHTML = "<td></td><td><code></code></td><td><code></code></td><td></td><td></td><td></td>";
        tr.children[0].textContent = key.name;
        tr.children[1].firstChild.textContent = key.key_preview;
        tr.children[2].firstChild.textContent = key.workspace_path || "";
        tr.children[3].textContent = formatDate(key.created_at);
        tr.children[4].textContent = formatDate(key.last_used_at);
        const button = document.createElement("button");
        button.className = "danger";
        button.textContent = "Revoke";
        button.addEventListener("click", () => revokeKey(key.id));
        tr.children[5].append(button);
        els.keysBody.append(tr);
      }
    }

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : "";
    }

    loadKeys();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
