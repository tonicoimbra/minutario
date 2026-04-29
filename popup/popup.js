document.addEventListener("DOMContentLoaded", () => {
  const openDashboardButton = document.getElementById("open-dashboard");
  const recentList = document.getElementById("recent-list");

  if (!openDashboardButton || !recentList) {
    return;
  }

  openDashboardButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "OPEN_DASHBOARD",
      payload: {
        source: "popup",
        focusExisting: true,
      },
    });
  });

  loadRecentTemplates(recentList);
});

async function loadRecentTemplates(container) {
  const localData = await chrome.storage.local.get("recent");
  const recent = Array.isArray(localData.recent) ? localData.recent.slice(0, 3) : [];

  if (recent.length === 0) {
    renderEmptyState(container);
    return;
  }

  const templates = await Promise.all(
    recent.map(async (id) => {
      const key = `tpl_${id}`;
      const syncData = await chrome.storage.sync.get(key);
      return { id, template: syncData[key] };
    })
  );

  const validTemplates = templates.filter(({ template }) => template && template.content);

  if (validTemplates.length === 0) {
    renderEmptyState(container);
    return;
  }

  container.innerHTML = "";

  validTemplates.forEach(({ id, template }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.dataset.templateId = id;

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = template.name || "Sem nome";

    const shortcut = document.createElement("span");
    shortcut.className = "recent-shortcut";
    shortcut.textContent = `/${template.shortcut || ""}`;

    button.append(name, shortcut);

    button.addEventListener("click", async () => {
      await copyTemplateById(id, button, template);
    });

    container.appendChild(button);
  });
}

async function copyTemplateById(id, button, initialTemplate) {
  const key = `tpl_${id}`;
  const syncData = await chrome.storage.sync.get(key);
  const template = syncData[key] || initialTemplate;

  if (!template || !template.content) {
    return;
  }

  const plain = stripHtml(template.content);

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([template.content], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    }),
  ]);

  const originalMarkup = button.innerHTML;
  button.textContent = "Copiado!";

  window.setTimeout(() => {
    button.innerHTML = originalMarkup;
  }, 1500);
}

function stripHtml(html) {
  const parser = document.createElement("div");
  parser.innerHTML = html;
  return (parser.textContent || parser.innerText || "").trim();
}

function renderEmptyState(container) {
  container.innerHTML = "";
  const message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = "Nenhum template usado ainda.";
  container.appendChild(message);
}
