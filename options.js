(() => {
  const KEY = "t3ApprovalAllowlistV1";
  const normalize = (value) => value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const digest = async (value) => { const bytes = new TextEncoder().encode(normalize(value)); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); };
  const load = (callback) => chrome.storage.local.get({ [KEY]: [] }, (result) => callback(Array.isArray(result[KEY]) ? result[KEY] : []));
  const save = (rules, callback) => chrome.storage.local.set({ [KEY]: [...new Set(rules)] }, callback);
  const status = (message) => { document.querySelector("#status").textContent = message; };
  const render = () => load((rules) => { const list = document.querySelector("#rules"); list.replaceChildren(); for (const rule of rules) { const item = document.createElement("li"); item.innerHTML = `<code>${rule}</code> <button data-rule="${rule}">删除</button>`; list.append(item); } });
  document.querySelector("#add").addEventListener("click", async () => { const command = document.querySelector("#command").value.trim(); if (!command) { status("请先粘贴完整命令。"); return; } const rule = await digest(command); load((rules) => save([...rules, rule], () => { document.querySelector("#command").value = ""; status(`已保存指纹 ${rule}`); render(); })); });
  document.querySelector("#rules").addEventListener("click", (event) => { const button = event.target.closest("button[data-rule]"); if (!button) return; load((rules) => save(rules.filter((rule) => rule !== button.dataset.rule), () => { status("已删除。"); render(); })); });
  render();
})();