(() => {
  const STORAGE_KEY = "fontSwitcher:globalSettings";

  function defaults() {
    return { version: 1, showComputedStack: false };
  }

  function normalize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      showComputedStack: Boolean(raw.showComputedStack),
    };
  }

  window.FontSwitcherSettings = {
    STORAGE_KEY,

    defaults,

    normalize,

    async load() {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return normalize(data[STORAGE_KEY]);
    },

    /** @param {Partial<{ showComputedStack: boolean }>} partial */
    async save(partial) {
      const cur = await window.FontSwitcherSettings.load();
      const next = { ...cur, ...partial, version: 1 };
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      return next;
    },
  };
})();
