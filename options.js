(() => {
  const KEY = "t3ApprovalAllowlistV1";
  const normalize = (value) => value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const digest = async (value) => { const bytes = new TextEncoder().encode(normalize(value)); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); };
  const load = (callback) => chrome.storage.local.get({ [KEY]: [] }, (result) => callback(Array.isArray(result[KEY]) ? result[KEY] : []));
  const save = (rules, callback) => chrome.storage.local.set({ [KEY]: rules }, callback);
  const status = (message) => { document.querySelector("#status").textContent = message; };
  const label = (rule) => typeof rule === "string" ? `精确 ${rule}` : `通配 ${rule.pattern}`;
  const render = () => load((rules) => {
    const list = document.querySelector("#rules");
    list.replaceChildren();
    rules.forEach((rule, index) => {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = label(rule);
      const button = document.createElement("button");
      button.textContent = "删除";
      button.dataset.index = String(index);
      item.append(code, " ", button);
      list.append(item);
    });
  });
  document.querySelector("#add").addEventListener("click", async () => {
    const input = document.querySelector("#command").value.trim();
    const mode = document.querySelector("#mode").value;
    if (!input) { status("请先输入命令或通配符规则。"); return; }
    const rule = mode === "glob" ? { type: "glob", pattern: normalize(input) } : await digest(input);
    load((rules) => save([...rules, rule], () => {
      document.querySelector("#command").value = "";
      status(mode === "glob" ? "已保存通配符规则。" : `已保存指纹 ${rule}`);
      render();
    }));
  });
  document.querySelector("#rules").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    load((rules) => save(rules.filter((_, index) => index !== Number(button.dataset.index)), () => { status("已删除。"); render(); }));
  });
  render();
})();
