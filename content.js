(() => {
  "use strict";
  const STORAGE_KEY = "t3ApprovalAllowlistV1";
  const scanned = new WeakSet();
  let scanTimer = null;
  let panel = null;

  const normalize = (value) => value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
  const readRules = () => new Promise((resolve) => chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => resolve(new Set((Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []).filter((rule) => /^[a-f0-9]{64}$/i.test(rule))))));
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

  const buildPanel = () => {
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "t3-approval-allowlist-panel";
      Object.assign(panel.style, { position: "fixed", top: "16px", right: "16px", width: "340px", maxHeight: "70vh", overflow: "auto", zIndex: "2147483647", background: "#171717", color: "#f4f4f4", border: "1px solid #444", borderRadius: "12px", boxShadow: "0 12px 40px rgba(0,0,0,.45)", padding: "12px", font: "13px system-ui,sans-serif" });
      document.documentElement.append(panel);
    }
    panel.replaceChildren();
    const title = document.createElement("div");
    title.textContent = "T3 待批准会话";
    Object.assign(title.style, { fontWeight: "700", marginBottom: "8px" });
    panel.append(title);
    const sessions = pendingSessions();
    const currentApprove = getApproveButton();
    if (currentApprove) {
      const current = document.createElement("button");
      current.textContent = "批准当前审批";
      current.type = "button";
      Object.assign(current.style, { display: "block", width: "100%", marginBottom: "10px", padding: "8px", border: "0", borderRadius: "7px", background: "#d97706", color: "white", cursor: "pointer" });
      current.addEventListener("click", () => currentApprove.click(), { once: true });
      panel.append(current);
    }
    if (sessions.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "当前没有待批准会话";
      empty.style.color = "#aaa";
      panel.append(empty);
      return;
    }
    for (const { button, text } of sessions) {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "8px", alignItems: "center", borderTop: "1px solid #333", padding: "8px 0" });
      const label = document.createElement("div");
      label.textContent = text;
      Object.assign(label.style, { flex: "1", lineHeight: "1.35" });
      const open = document.createElement("button");
      open.textContent = "打开";
      open.type = "button";
      Object.assign(open.style, { padding: "5px 8px", border: "0", borderRadius: "6px", background: "#2563eb", color: "white", cursor: "pointer" });
      open.addEventListener("click", () => button.click());
      row.append(label, open);
      panel.append(row);
    }
  };

  const autoApproveAllowlisted = async () => {
    const rules = await readRules();
    if (rules.size === 0) return;
    const buttons = [...document.querySelectorAll("button")].filter(visible).filter((button) => !scanned.has(button) && !button.dataset.t3ApprovalAllowlistScanned).filter((button) => /^(批准|approve)$/i.test((button.innerText || button.getAttribute("aria-label") || "").trim()));
    for (const button of buttons) {
      const card = approvalCardFor(button);
      if (!card) continue;
      const command = commandFrom(card);
      if (!command) continue;
      const fingerprint = await digest(command);
      scanned.add(button);
      button.dataset.t3ApprovalAllowlistScanned = "1";
      if (rules.has(fingerprint)) {
        button.click();
        console.info("T3 Approval Allowlist approved a matching command", fingerprint);
      }
    }
  };
  const scan = () => { if (location.hostname !== "t3.like.cloud" || location.protocol !== "https:") return; buildPanel(); void autoApproveAllowlisted(); };
  const schedule = () => { if (scanTimer !== null) return; scanTimer = window.setTimeout(() => { scanTimer = null; scan(); }, 150); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.setInterval(schedule, 1200);
  schedule();
})();
