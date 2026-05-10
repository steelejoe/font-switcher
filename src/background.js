const UI_WINDOW_STORAGE_KEY = "fontSwitcherUiWindowId";
const APP_PATH = "src/ui/app.html";

async function openOrFocusAppWindow() {
  const stored = await chrome.storage.local.get(UI_WINDOW_STORAGE_KEY);
  const existingId = stored[UI_WINDOW_STORAGE_KEY];
  if (existingId != null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return existingId;
    } catch {
      await chrome.storage.local.remove(UI_WINDOW_STORAGE_KEY);
    }
  }

  const url = chrome.runtime.getURL(APP_PATH);
  const win = await chrome.windows.create({
    url,
    // Minimal chrome: no tab strip, omnibox, or bookmarks bar (OS title bar remains).
    type: "popup",
    width: 560,
    height: 720,
    focused: true,
  });

  if (win?.id != null) {
    await chrome.storage.local.set({ [UI_WINDOW_STORAGE_KEY]: win.id });
  }
  return win?.id ?? null;
}

async function setTargetTab(tabId) {
  if (tabId != null) {
    await chrome.storage.session.set({ fontSwitcherTargetTabId: tabId });
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(UI_WINDOW_STORAGE_KEY).then((data) => {
    if (data[UI_WINDOW_STORAGE_KEY] === windowId) {
      chrome.storage.local.remove(UI_WINDOW_STORAGE_KEY);
    }
  });
});

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "fontSwitcher",
      title: "Font Switcher",
      contexts: ["page", "frame", "selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenus);
ensureContextMenus();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const u = tab.url ?? "";
  if (u.startsWith("chrome://") || u.startsWith("chrome-extension://") || u.startsWith("edge://")) {
    return;
  }
  await setTargetTab(tab.id);
  await chrome.storage.session.remove(["fontSwitcherPendingSelection"]);
  await openOrFocusAppWindow();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "fontSwitcher") return;
  if (!tab?.id) return;
  const u = tab.url ?? "";
  if (u.startsWith("chrome://") || u.startsWith("chrome-extension://") || u.startsWith("edge://")) {
    return;
  }

  await setTargetTab(tab.id);

  const hasSelection = Boolean(info.selectionText?.trim());
  if (hasSelection) {
    await chrome.storage.session.set({ fontSwitcherPendingSelection: true });
  } else {
    await chrome.storage.session.remove(["fontSwitcherPendingSelection"]);
  }

  await openOrFocusAppWindow();
});
