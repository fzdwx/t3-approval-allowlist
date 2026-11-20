(() => {
  "use strict";
  const STORAGE_KEY = "t3ApprovalAllowlistV1";
  const scanned = new WeakSet();
  const approvals = new Map();
  const threadTitles = new Map();
  const knownThreads = new Map();
  const subscribed = new Set();
  let scanTimer = null;
  let panel = null;

  const injectBridge = () => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-bridge.js");
    script.onload = () => script.remove();
    (document.documentElement || document.head).append(script);
  };
  injectBridge();

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const digest = async (value) => {
    const bytes = new TextEncoder().encode(normalize(value));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const globRegExp = (pattern) => {
    let source = "^";
    for (const character of normalize(pattern)) {
      if (character === "*") source += "[\s\S]*";
      else if (character === "?") source += "[\s\S]";
      else source += character.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
    }
    return new RegExp(`${source}$`);
  };
  const readRules = () => new Promise((resolve) => chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
    const raw = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    resolve({
      hashes: new Set(raw.filter((rule) => typeof rule === "string" && /^[a-f0-9]{64}$/i.test(rule))),
      globs: raw.filter((rule) => rule && typeof rule === "object" && rule.type === "glob" && typeof rule.pattern === "string").map((rule) => globRegExp(rule.pattern)),
    });
  }));
  const approvalCardFor = (button) => {
    let node = button;
    for (let level = 0; level < 8 && node; level += 1, node = node.parentElement) {
      const text = (node.innerText || "").trim();
      if (text.length > 0 && text.length < 100000 && /(等待批准|需要批准|approval required|approve)/i.test(text)) return node;
    }
    return null;
  };
  const commandFrom = (card) => {
    const blocks = [...card.querySelectorAll("pre, code, textarea")].filter(visible).map((element) => (element.value ?? element.innerText ?? element.textContent ?? "").trim()).filter(Boolean);
    if (blocks.length > 0) return blocks.sort((a, b) => b.length - a.length)[0];
    return (card.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !/^(等待批准|批准|拒绝|更多|approve|reject)$/i.test(line)).join("\n");
  };
  const getApproveButton = () => [...document.querySelectorAll("button")].find((button) => visible(button) && /^(批准|approve)$/i.test((button.innerText || button.getAttribute("aria-label") || "").trim()) && approvalCardFor(button));
  const pendingSessions = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible).map((button) => ({ button, text: (button.innerText || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim() })).filter(({ text }) => /待批准/.test(text) && text.length < 300).filter(({ button }) => !button.closest("#t3-approval-allowlist-panel"));
  const subscribeVisiblePendingSessions = () => {
    for (const { text } of pendingSessions()) {
      for (const [threadId, thread] of knownThreads) {
        if (thread.title && text.includes(thread.title)) subscribeThread(threadId);
      }
    }
  };
  const postRequest = (request) => window.postMessage({ source: "t3-approval-allowlist-page", type: "request", request }, "*");
  const subscribeThread = (threadId) => {
    if (!threadId || subscribed.has(threadId)) return;
    subscribed.add(threadId);
    postRequest({ tag: "orchestration.subscribeThread", payload: { threadId, afterSequence: 0, requestCompletionMarker: true, acceptBoundedSnapshot: true, acceptDeferredWork: true, acceptCompactTurnItems: true, acceptDedupedBodies: true, acceptCompactIds: true }, traceId: crypto.randomUUID(), spanId: crypto.randomUUID(), sampled: false, headers: [] });
  };
  const textCandidate = (object) => {
    if (!object || typeof object !== "object") return "";
    for (const key of ["prompt", "detail", "reason", "command", "cmd", "description", "text"]) {
      if (typeof object[key] === "string" && object[key].trim()) return object[key].trim();
    }
    if (Array.isArray(object.options)) {
      const optionText = object.options.map((option) => typeof option === "string" ? option : option?.label ?? option?.description ?? "").filter(Boolean).join("\n");
      if (optionText) return optionText;
    }
    return "";
  };
  const visitBackend = (value, context = {}) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visitBackend(item, context); return; }
    const next = { ...context };
    if (typeof value.threadId === "string") next.threadId = value.threadId;
    if (typeof value.requestId === "string") next.requestId = value.requestId;
    else if (typeof value.id === "string" && (value.kind === "approval_request" || value.requestKind === "command")) next.requestId = value.id;
    if (typeof value.title === "string") next.title = value.title;
    if (value.thread && typeof value.thread === "object") {
      if (typeof value.thread.id === "string") next.threadId = value.thread.id;
      if (typeof value.thread.title === "string") {
        next.title = value.thread.title;
        threadTitles.set(value.thread.id, value.thread.title);
        knownThreads.set(value.thread.id, value.thread);
      }
      if (value.thread.pendingRuntimeRequest?.id) subscribeThread(value.thread.id);
      else if (value.thread.id && value.thread.pendingRuntimeRequest === null) {
        for (const key of approvals.keys()) if (key.startsWith(`${value.thread.id}:`)) approvals.delete(key);
      }
    }
    if (value.snapshot?.threads) visitBackend(value.snapshot.threads, next);
    if (value.thread?.pendingRuntimeRequest?.id) subscribeThread(value.thread.id);
    const resolved = (value.type === "runtime-request.updated" || value.type === "approval_request" || value.kind === "approval_request") && value.status && value.status !== "pending" && value.status !== "waiting";
    if (resolved && next.threadId && next.requestId) approvals.delete(`${next.threadId}:${next.requestId}`);
    const isApproval = value.kind === "approval_request" || value.type === "approval_request" || value.requestKind === "command";
    if (isApproval && next.threadId && next.requestId && !resolved) {
      const detail = textCandidate(value);
      const existing = approvals.get(`${next.threadId}:${next.requestId}`) || {};
      approvals.set(`${next.threadId}:${next.requestId}`, { ...existing, threadId: next.threadId, requestId: next.requestId, title: next.title || threadTitles.get(next.threadId) || existing.title || "待批准会话", detail: detail || existing.detail || "审批命令详情已同步，展开查看原始请求" });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "snapshot" || key === "thread") continue;
      visitBackend(child, next);
    }
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "t3-approval-allowlist-page" || event.data.type !== "frame") return;
    let payload;
    try { payload = typeof event.data.data === "string" ? JSON.parse(event.data.data) : event.data.data; } catch { return; }
    visitBackend(payload);
    schedule();
  });

  const buildPanel = () => {
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "t3-approval-allowlist-panel";
      Object.assign(panel.style, { position: "fixed", top: "16px", right: "16px", width: "380px", maxHeight: "75vh", overflow: "auto", zIndex: "2147483647", background: "#171717", color: "#f4f4f4", border: "1px solid #444", borderRadius: "12px", boxShadow: "0 12px 40px rgba(0,0,0,.45)", padding: "12px", font: "13px system-ui,sans-serif" });
      document.documentElement.append(panel);
    }
    panel.replaceChildren();
    const title = document.createElement("div");
    title.textContent = "T3 待批准命令";
    Object.assign(title.style, { fontWeight: "700", marginBottom: "8px" });
    panel.append(title);
    const currentApprove = getApproveButton();
    if (currentApprove) {
      const current = document.createElement("button");
      current.textContent = "批准当前审批";
      current.type = "button";
      Object.assign(current.style, { display: "block", width: "100%", marginBottom: "10px", padding: "8px", border: "0", borderRadius: "7px", background: "#d97706", color: "white", cursor: "pointer" });
      current.addEventListener("click", () => currentApprove.click(), { once: true });
      panel.append(current);
    }
    const entries = [...approvals.values()];
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "正在等待后端同步审批命令";
      empty.style.color = "#aaa";
      panel.append(empty);
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      Object.assign(row.style, { borderTop: "1px solid #333", padding: "9px 0" });
      const label = document.createElement("div");
      label.textContent = entry.title;
      Object.assign(label.style, { fontWeight: "600", marginBottom: "5px" });
      const command = document.createElement("pre");
      command.textContent = entry.detail;
      Object.assign(command.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "0 0 7px", color: "#ddd", maxHeight: "130px", overflow: "auto" });
      const open = document.createElement("button");
      open.textContent = "打开会话";
      open.type = "button";
      Object.assign(open.style, { padding: "5px 8px", border: "0", borderRadius: "6px", background: "#2563eb", color: "white", cursor: "pointer" });
      open.addEventListener("click", () => { const target = pendingSessions().find(({ text }) => text.includes(entry.title)); target?.button.click(); });
      row.append(label, command, open);
      panel.append(row);
    }
  };
  const autoApproveAllowlisted = async () => {
    const rules = await readRules();
    if (rules.hashes.size === 0 && rules.globs.length === 0) return;
    const buttons = [...document.querySelectorAll("button")].filter(visible).filter((button) => !scanned.has(button) && !button.dataset.t3ApprovalAllowlistScanned).filter((button) => /^(批准|approve)$/i.test((button.innerText || button.getAttribute("aria-label") || "").trim()));
    for (const button of buttons) {
      const card = approvalCardFor(button);
      if (!card) continue;
      const command = commandFrom(card);
      if (!command) continue;
      const fingerprint = await digest(command);
      scanned.add(button);
      button.dataset.t3ApprovalAllowlistScanned = "1";
      if (rules.hashes.has(fingerprint) || rules.globs.some((rule) => rule.test(command))) button.click();
    }
  };
  function scan() { if (location.hostname !== "t3.like.cloud" || location.protocol !== "https:") return; subscribeVisiblePendingSessions(); buildPanel(); void autoApproveAllowlisted(); }
  function schedule() { if (scanTimer !== null) return; scanTimer = window.setTimeout(() => { scanTimer = null; scan(); }, 150); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.setInterval(schedule, 1200);
  schedule();
})();
