export function adminHtml({ authRequired, defaultWorkspace, workspaceRoots }) {
  const roots = workspaceRoots.length ? workspaceRoots.join(", ") : "(unrestricted)";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex App Server API</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    body {
      margin: 0;
      background: #f6f7f9;
      color: #17181c;
    }
    main {
      width: min(1040px, calc(100vw - 32px));
      margin: 32px auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 16px;
      font-size: 18px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #5d6472;
    }
    section {
      background: #fff;
      border: 1px solid #dde1e7;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 650;
      margin: 0 0 6px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cbd1da;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cbd1da;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    nav {
      display: flex;
      gap: 8px;
      margin: 0 0 18px;
      flex-wrap: wrap;
    }
    nav a {
      border: 1px solid #cbd1da;
      border-radius: 6px;
      color: inherit;
      padding: 8px 11px;
      text-decoration: none;
      font-weight: 650;
      font-size: 14px;
    }
    nav a.active {
      background: #16181d;
      border-color: #16181d;
      color: #fff;
    }
    .page {
      display: none;
    }
    .page.active {
      display: block;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 12px;
      align-items: end;
    }
    button {
      border: 1px solid #16181d;
      background: #16181d;
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
      color: #16181d;
      border-color: #cbd1da;
    }
    button.danger {
      background: #9f1d1d;
      border-color: #9f1d1d;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid #e6e9ee;
      padding: 10px 8px;
      vertical-align: top;
    }
    th {
      color: #5d6472;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    pre {
      overflow: auto;
      background: #101216;
      color: #f3f5f7;
      padding: 14px;
      border-radius: 6px;
      margin: 12px 0 0;
    }
    .muted {
      color: #6b7280;
      font-size: 13px;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .keyCell {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .smallButton {
      padding: 6px 9px;
      font-size: 12px;
    }
    .checkline {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 14px;
      margin: 0;
    }
    .checkline input {
      width: auto;
    }
    .modelOptions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .modelOption {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #dde1e7;
      border-radius: 6px;
      padding: 9px 10px;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .modelOption input {
      width: auto;
      flex: 0 0 auto;
    }
    .tagList {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #cbd1da;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 13px;
      overflow-wrap: anywhere;
      max-width: 100%;
    }
    .tag button {
      border: 0;
      background: transparent;
      color: inherit;
      padding: 0 2px;
      font-size: 16px;
      line-height: 1;
    }
    .notice {
      display: none;
      border-color: #b7d0ff;
      background: #edf4ff;
    }
    .error {
      color: #9f1d1d;
      min-height: 20px;
      margin-top: 8px;
      font-size: 14px;
    }
    .success {
      color: #146c43;
      min-height: 20px;
      margin-top: 8px;
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
        background: #111318;
        color: #edf0f5;
      }
      section, input, select, button.secondary, .modelOption, .tag {
        background: #181b21;
        border-color: #303641;
      }
      p, .muted, th {
        color: #a6afbf;
      }
      input, select, button.secondary {
        color: #edf0f5;
      }
      .notice {
        background: #13223a;
        border-color: #294d86;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex App Server API</h1>
        <p>Issue local API keys for OpenAI-compatible Codex endpoints.</p>
      </div>
      <div class="muted">
        <div>Auth required: <strong>${authRequired ? "yes" : "no"}</strong></div>
        <div>Default workspace: <code>${escapeHtml(defaultWorkspace)}</code></div>
        <div>Workspace roots: <code>${escapeHtml(roots)}</code></div>
      </div>
    </header>

    <nav>
      <a href="/admin" data-page-link="keys">API Keys</a>
      <a href="/settings" data-page-link="settings">Settings</a>
    </nav>

    <section>
      <h2>Admin Token</h2>
      <div class="grid" style="grid-template-columns: 1fr auto auto">
        <div>
          <label for="adminToken">Token</label>
          <input id="adminToken" type="password" autocomplete="off" placeholder="adm_...">
        </div>
        <button id="saveToken" class="secondary">Save</button>
        <button id="refreshKeys">Refresh</button>
      </div>
      <div class="muted" style="margin-top: 8px">Read it from <code>data/admin-token.txt</code> or set <code>ADMIN_TOKEN</code>.</div>
      <div id="tokenError" class="error"></div>
    </section>

    <div id="keysPage" class="page">
      <section>
        <h2>Create API Key</h2>
        <div class="grid" style="grid-template-columns: 1fr auto">
          <div>
            <label for="keyName">Name</label>
            <input id="keyName" placeholder="local dev key">
          </div>
          <button id="createKey">Create key</button>
        </div>
        <div id="createError" class="error"></div>
      </section>

      <section id="newKeyNotice" class="notice">
        <h2>New Key</h2>
        <p>Copy this value now. Only a hash is stored after creation.</p>
        <pre id="newKey"></pre>
        <div class="row" style="margin-top: 10px">
          <button id="copyKey" class="secondary">Copy</button>
          <a id="configureNewKey" href="/settings" class="muted">Settings</a>
        </div>
      </section>

      <section>
        <h2>Issued Keys</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Workspace</th>
              <th>Models</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="keysBody"></tbody>
        </table>
      </section>

      <section>
        <h2>Example</h2>
        <pre id="curlExample"></pre>
      </section>
    </div>

    <div id="settingsPage" class="page">
      <section>
        <h2>Key Settings</h2>
        <div class="grid" style="grid-template-columns: 1fr 1fr auto">
          <div>
            <label for="settingsKey">API key</label>
            <select id="settingsKey"></select>
          </div>
          <div>
            <label for="settingsWorkspacePath">Workspace path</label>
            <input id="settingsWorkspacePath" placeholder="${escapeHtml(defaultWorkspace)}">
          </div>
          <button id="saveKeySettings">Save</button>
        </div>
        <div class="muted" style="margin-top: 8px">Leave workspace blank to use the server default workspace.</div>
        <div style="margin-top: 16px">
          <label class="checkline">
            <input id="allowAllModels" type="checkbox">
            <span>Allow all configured models</span>
          </label>
          <div id="modelRestrictionPanel">
            <div class="muted" style="margin-top: 8px">Choose which models this API key can call. Custom IDs and suffix wildcards like <code>gpt-5.6-*</code> are supported.</div>
            <div id="modelOptions" class="modelOptions"></div>
            <div class="row" style="margin-top: 10px">
              <input id="customModelId" placeholder="gpt-5.6-*">
              <button id="addCustomModel" class="secondary" type="button">Add model</button>
              <button id="selectAllModels" class="secondary" type="button">Select all</button>
              <button id="clearModels" class="secondary" type="button">Clear</button>
            </div>
            <div id="customModels" class="tagList"></div>
          </div>
        </div>
        <div id="settingsError" class="error"></div>
        <div id="settingsSuccess" class="success"></div>
      </section>
    </div>
  </main>

  <script>
    const els = {
      adminToken: document.getElementById("adminToken"),
      saveToken: document.getElementById("saveToken"),
      refreshKeys: document.getElementById("refreshKeys"),
      keysPage: document.getElementById("keysPage"),
      settingsPage: document.getElementById("settingsPage"),
      keyName: document.getElementById("keyName"),
      createKey: document.getElementById("createKey"),
      newKeyNotice: document.getElementById("newKeyNotice"),
      newKey: document.getElementById("newKey"),
      copyKey: document.getElementById("copyKey"),
      configureNewKey: document.getElementById("configureNewKey"),
      keysBody: document.getElementById("keysBody"),
      curlExample: document.getElementById("curlExample"),
      settingsKey: document.getElementById("settingsKey"),
      settingsWorkspacePath: document.getElementById("settingsWorkspacePath"),
      allowAllModels: document.getElementById("allowAllModels"),
      modelRestrictionPanel: document.getElementById("modelRestrictionPanel"),
      modelOptions: document.getElementById("modelOptions"),
      customModelId: document.getElementById("customModelId"),
      addCustomModel: document.getElementById("addCustomModel"),
      selectAllModels: document.getElementById("selectAllModels"),
      clearModels: document.getElementById("clearModels"),
      customModels: document.getElementById("customModels"),
      saveKeySettings: document.getElementById("saveKeySettings"),
      tokenError: document.getElementById("tokenError"),
      createError: document.getElementById("createError"),
      settingsError: document.getElementById("settingsError"),
      settingsSuccess: document.getElementById("settingsSuccess"),
    };
    let currentKeys = [];
    let availableModels = [];
    let customModels = [];
    const issuedSecrets = new Map();

    els.adminToken.value = localStorage.getItem("codexApiAdminToken") || "";
    renderExample("sk-codex-...");
    setActivePage(location.pathname.includes("settings") ? "settings" : "keys");

    els.saveToken.addEventListener("click", () => {
      localStorage.setItem("codexApiAdminToken", els.adminToken.value.trim());
      loadAdminData();
    });
    els.refreshKeys.addEventListener("click", loadAdminData);
    els.createKey.addEventListener("click", createKey);
    els.copyKey.addEventListener("click", () => copyText(els.newKey.textContent, els.copyKey));
    els.settingsKey.addEventListener("change", () => selectSettingsKey(els.settingsKey.value));
    els.allowAllModels.addEventListener("change", updateModelRestrictionState);
    els.addCustomModel.addEventListener("click", addCustomModel);
    els.customModelId.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCustomModel();
      }
    });
    els.selectAllModels.addEventListener("click", () => {
      for (const checkbox of modelCheckboxes()) checkbox.checked = true;
    });
    els.clearModels.addEventListener("click", () => {
      for (const checkbox of modelCheckboxes()) checkbox.checked = false;
      customModels = [];
      renderCustomModels();
    });
    els.saveKeySettings.addEventListener("click", saveKeySettings);

    async function api(path, options = {}) {
      const token = els.adminToken.value.trim();
      const res = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || "Request failed");
      return data;
    }

    async function loadKeys() {
      els.tokenError.textContent = "";
      try {
        const data = await api("/admin/api/keys");
        currentKeys = data.keys || [];
        renderKeys(currentKeys);
        renderSettingsOptions(currentKeys);
      } catch (error) {
        els.tokenError.textContent = error.message;
      }
    }

    async function loadModels() {
      const data = await api("/admin/api/models");
      availableModels = data.models || [];
      renderModelOptions();
    }

    async function loadAdminData() {
      try {
        await loadModels();
      } catch (error) {
        els.tokenError.textContent = error.message;
      }
      await loadKeys();
    }

    async function createKey() {
      els.createError.textContent = "";
      try {
        const data = await api("/admin/api/keys", {
          method: "POST",
          body: JSON.stringify({
            name: els.keyName.value,
          }),
        });
        issuedSecrets.set(data.id, data.key);
        els.newKey.textContent = data.key;
        els.newKeyNotice.style.display = "block";
        els.configureNewKey.href = "/settings/" + encodeURIComponent(data.id);
        renderExample(data.key);
        await loadKeys();
      } catch (error) {
        els.createError.textContent = error.message;
      }
    }

    async function revokeKey(id) {
      await api("/admin/api/keys/" + encodeURIComponent(id), { method: "DELETE" });
      await loadKeys();
    }

    async function saveKeySettings() {
      els.settingsError.textContent = "";
      els.settingsSuccess.textContent = "";
      const id = els.settingsKey.value;
      if (!id) return;
      try {
        await api("/admin/api/keys/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify({
            workspace_path: els.settingsWorkspacePath.value,
            allowed_models: selectedAllowedModels(),
          }),
        });
        els.settingsSuccess.textContent = "Saved.";
        await loadKeys();
        selectSettingsKey(id);
      } catch (error) {
        els.settingsError.textContent = error.message;
      }
    }

    function renderKeys(keys) {
      if (!keys.length) {
        els.keysBody.innerHTML = '<tr><td colspan="7" class="muted">No keys yet.</td></tr>';
        return;
      }
      els.keysBody.innerHTML = "";
      for (const key of keys) {
        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td></td>
          <td><div class="keyCell"><code></code></div></td>
          <td><code></code></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        \`;
        tr.children[0].textContent = key.name;
        tr.children[1].querySelector("code").textContent = key.key_preview;
        tr.children[1].querySelector(".keyCell").append(copyKeyButton(key));
        tr.children[2].firstChild.textContent = key.workspace_path || "(server default)";
        tr.children[3].textContent = describeModels(key.allowed_models || []);
        tr.children[4].textContent = formatDate(key.created_at);
        tr.children[5].textContent = formatDate(key.last_used_at);
        const settingsButton = document.createElement("button");
        settingsButton.className = "secondary";
        settingsButton.textContent = "Settings";
        settingsButton.addEventListener("click", () => {
          location.href = "/settings/" + encodeURIComponent(key.id);
        });
        const button = document.createElement("button");
        button.className = "danger";
        button.textContent = "Revoke";
        button.addEventListener("click", () => revokeKey(key.id));
        tr.children[6].append(settingsButton, button);
        els.keysBody.append(tr);
      }
    }

    function copyKeyButton(key) {
      const button = document.createElement("button");
      button.className = "secondary smallButton";
      button.type = "button";
      button.textContent = "Copy";
      const secret = issuedSecrets.get(key.id);
      if (!secret) {
        button.disabled = true;
        button.title = "Full key is only available immediately after creation.";
        return button;
      }
      button.addEventListener("click", () => copyText(secret, button));
      return button;
    }

    function renderSettingsOptions(keys) {
      const previous = selectedKeyFromLocation() || els.settingsKey.value;
      els.settingsKey.innerHTML = "";
      for (const key of keys) {
        const option = document.createElement("option");
        option.value = key.id;
        option.textContent = key.name + " (" + key.key_preview + ")";
        els.settingsKey.append(option);
      }
      if (keys.length) {
        selectSettingsKey(keys.some((key) => key.id === previous) ? previous : keys[0].id);
      } else {
        els.settingsWorkspacePath.value = "";
      }
    }

    function selectSettingsKey(id) {
      const key = currentKeys.find((item) => item.id === id);
      if (!key) return;
      els.settingsKey.value = key.id;
      els.settingsWorkspacePath.value = key.workspace_path || "";
      applyAllowedModels(key.allowed_models || []);
    }

    function setActivePage(page) {
      els.keysPage.classList.toggle("active", page === "keys");
      els.settingsPage.classList.toggle("active", page === "settings");
      for (const link of document.querySelectorAll("[data-page-link]")) {
        link.classList.toggle("active", link.dataset.pageLink === page);
      }
    }

    function renderExample(key) {
      els.curlExample.textContent = \`curl http://127.0.0.1:${escapeJs(String(process.env.PORT || 8787))}/v1/responses \\\\\\n  -H 'authorization: Bearer \${key}' \\\\\\n  -H 'content-type: application/json' \\\\\\n  -d '{"model":"gpt-5.4","input":"Summarize this repo briefly."}'\`;
    }

    function renderModelOptions() {
      els.modelOptions.innerHTML = "";
      for (const model of availableModels) {
        const label = document.createElement("label");
        label.className = "modelOption";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = model;
        checkbox.dataset.modelCheckbox = "1";
        const text = document.createElement("span");
        text.textContent = model;
        label.append(checkbox, text);
        els.modelOptions.append(label);
      }
      const selectedKey = currentKeys.find((key) => key.id === els.settingsKey.value);
      if (selectedKey) applyAllowedModels(selectedKey.allowed_models || []);
    }

    function applyAllowedModels(models) {
      const allowed = unique(models);
      els.allowAllModels.checked = allowed.length === 0;
      const allowedSet = new Set(allowed);
      for (const checkbox of modelCheckboxes()) {
        checkbox.checked = allowedSet.has(checkbox.value);
      }
      customModels = allowed.filter((model) => !availableModels.includes(model));
      renderCustomModels();
      updateModelRestrictionState();
    }

    function selectedAllowedModels() {
      if (els.allowAllModels.checked) return [];
      const selected = modelCheckboxes()
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
      const models = unique([...selected, ...customModels]);
      if (!models.length) {
        throw new Error("Select at least one model or allow all configured models.");
      }
      return models;
    }

    function addCustomModel() {
      const model = els.customModelId.value.trim();
      if (!model) return;
      if (!customModels.includes(model) && !availableModels.includes(model)) {
        customModels.push(model);
      }
      const checkbox = modelCheckboxes().find((item) => item.value === model);
      if (checkbox) checkbox.checked = true;
      els.customModelId.value = "";
      renderCustomModels();
    }

    function renderCustomModels() {
      els.customModels.innerHTML = "";
      for (const model of customModels) {
        const tag = document.createElement("span");
        tag.className = "tag";
        const text = document.createElement("span");
        text.textContent = model;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "x";
        remove.addEventListener("click", () => {
          customModels = customModels.filter((item) => item !== model);
          renderCustomModels();
        });
        tag.append(text, remove);
        els.customModels.append(tag);
      }
    }

    function updateModelRestrictionState() {
      const disabled = els.allowAllModels.checked;
      els.modelRestrictionPanel.style.opacity = disabled ? ".55" : "1";
      for (const control of [
        ...modelCheckboxes(),
        els.customModelId,
        els.addCustomModel,
        els.selectAllModels,
        els.clearModels,
      ]) {
        control.disabled = disabled;
      }
    }

    function modelCheckboxes() {
      return Array.from(document.querySelectorAll("[data-model-checkbox]"));
    }

    function describeModels(models) {
      const allowed = unique(models);
      if (!allowed.length) return "All";
      if (allowed.length <= 2) return allowed.join(", ");
      return allowed.slice(0, 2).join(", ") + " +" + (allowed.length - 2);
    }

    function selectedKeyFromLocation() {
      const queryKey = new URLSearchParams(location.search).get("key");
      if (queryKey) return queryKey;
      const parts = location.pathname.split("/").filter(Boolean);
      if (parts[0] === "admin" && parts[1] === "settings" && parts[2]) return decodeURIComponent(parts[2]);
      return parts[0] === "settings" && parts[1] ? decodeURIComponent(parts[1]) : "";
    }

    function unique(values) {
      return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
    }

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : "";
    }

    async function copyText(text, button) {
      const value = String(text || "");
      if (!value) return;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      if (button) markCopied(button);
    }

    function markCopied(button) {
      const previous = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    }

    loadAdminData();
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

function escapeJs(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
