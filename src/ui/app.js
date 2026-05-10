(() => {
  const EXT = "fontSwitcher";

  const originLabel = document.getElementById("originLabel");
  const statusLine = document.getElementById("statusLine");
  const scanBtn = document.getElementById("scanBtn");
  const resetPageBtn = document.getElementById("resetPageBtn");
  const optionsBtn = document.getElementById("optionsBtn");
  const filterFamily = document.getElementById("filterFamily");
  const filterSnippet = document.getElementById("filterSnippet");
  const listRoot = document.getElementById("listRoot");
  const rowTpl = document.getElementById("rowTpl");

  /** @type {number | null} */
  let targetTabId = null;
  /** @type {string | null} */
  let targetOrigin = null;
  /** @type {Array<any>} */
  let lastCombos = [];
  /** @type {Record<string, any>} */
  let overrides = {};

  const CUSTOM_FAMILY_VALUE = "__custom__";

  /** CSS generics and fonts commonly available on Linux/macOS/Windows (requested by name; browser falls back if missing). */
  const GENERIC_AND_COMMON_FONTS = [
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "ui-rounded",
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "Helvetica",
    "Georgia",
    "Times New Roman",
    "Times",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Courier New",
    "Courier",
    "Consolas",
    "Menlo",
    "Monaco",
    "Ubuntu",
    "Ubuntu Mono",
    "Liberation Sans",
    "Liberation Serif",
    "Liberation Mono",
    "DejaVu Sans",
    "DejaVu Serif",
    "DejaVu Sans Mono",
    "Noto Sans",
    "Noto Serif",
    "Noto Sans Mono",
    "Cantarell",
    "Source Sans Pro",
    "Source Serif Pro",
    "Source Code Pro",
    "Inter",
    "Open Sans",
    "Lato",
    "Fira Sans",
    "Fira Mono",
    "IBM Plex Sans",
    "IBM Plex Serif",
    "IBM Plex Mono",
  ];

  /** @type {Promise<Set<string>> | null} */
  let osFontsPromise = null;

  function parseStackFamilies(stack) {
    if (!stack || typeof stack !== "string") return [];
    return stack
      .split(",")
      .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
      .filter(Boolean);
  }

  /** All distinct family names from the last scan (primary + parsed stack). */
  function familiesFromCombos(combos) {
    const set = new Set();
    for (const c of combos) {
      if (c.family) set.add(String(c.family).trim());
      for (const name of parseStackFamilies(c.familyStack)) set.add(name);
    }
    return set;
  }

  function sortFamilies(names) {
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  /** Enumerate installed local fonts when the browser exposes Local Font Access (Chrome); otherwise empty. */
  function getOsFontFamilySet() {
    if (!osFontsPromise) {
      osFontsPromise = (async () => {
        const set = new Set();
        try {
          const q = /** @type {unknown} */ (globalThis).queryLocalFonts;
          if (typeof q !== "function") return set;
          const fonts = await /** @type {() => Promise<Array<{ family?: string }>>} */ (q).call(globalThis);
          for (const fd of fonts) {
            const fam = fd.family?.trim();
            if (fam) set.add(fam);
          }
        } catch {
          /* Permission denied or API unavailable */
        }
        return set;
      })();
    }
    return osFontsPromise;
  }

  /** @param {HTMLSelectElement} select */
  function appendFamilyOptions(select, pageSorted, otherSorted) {
    select.textContent = "";

    if (pageSorted.length > 0) {
      const g1 = document.createElement("optgroup");
      g1.label = "Seen on this page";
      for (const name of pageSorted) {
        const o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        g1.appendChild(o);
      }
      select.appendChild(g1);
    }

    const g2 = document.createElement("optgroup");
    g2.label = "Generic & system";
    for (const name of otherSorted) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      g2.appendChild(o);
    }
    const oCustom = document.createElement("option");
    oCustom.value = CUSTOM_FAMILY_VALUE;
    oCustom.textContent = "Custom…";
    g2.appendChild(oCustom);
    select.appendChild(g2);
  }

  /** @param {HTMLSelectElement} select */
  function findFamilyOptionMatch(select, fontFamily) {
    const v = fontFamily.trim();
    if (!v) return null;
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      if (opt.value === CUSTOM_FAMILY_VALUE) continue;
      if (opt.value === v) return opt;
    }
    const lower = v.toLowerCase();
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      if (opt.value === CUSTOM_FAMILY_VALUE) continue;
      if (opt.value.toLowerCase() === lower) return opt;
    }
    return null;
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {HTMLInputElement} customInput
   */
  function syncFamilyControls(select, customInput, fontFamily) {
    const v = String(fontFamily ?? "").trim();
    if (v.includes(",") || !findFamilyOptionMatch(select, v)) {
      select.value = CUSTOM_FAMILY_VALUE;
      customInput.hidden = false;
      customInput.value = v;
    } else {
      const opt = findFamilyOptionMatch(select, v);
      select.value = opt ? opt.value : CUSTOM_FAMILY_VALUE;
      customInput.hidden = select.value !== CUSTOM_FAMILY_VALUE;
      customInput.value = customInput.hidden ? "" : v;
    }
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {HTMLInputElement} customInput
   */
  function readFamilyFromControls(select, customInput) {
    if (select.value === CUSTOM_FAMILY_VALUE) return customInput.value.trim();
    return select.value.trim();
  }

  function storageKeyForOrigin(origin) {
    return `${EXT}:${encodeURIComponent(origin)}`;
  }

  function applyUiSettings(settings) {
    document.body.classList.toggle("show-computed-stack", Boolean(settings.showComputedStack));
  }

  async function refreshUiSettings() {
    const s = await FontSwitcherSettings.load();
    applyUiSettings(s);
    return s;
  }

  function setStatus(text, isError = false) {
    statusLine.textContent = text;
    statusLine.style.color = isError ? "#f87171" : "";
  }

  async function resolveTargetTabId() {
    const session = await chrome.storage.session.get("fontSwitcherTargetTabId");
    const id = session.fontSwitcherTargetTabId;
    if (typeof id === "number") return id;

    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const t = tabs[0];
    return typeof t?.id === "number" ? t.id : null;
  }

  async function bindTabContext() {
    targetTabId = await resolveTargetTabId();
    if (targetTabId == null) {
      originLabel.textContent = "—";
      targetOrigin = null;
      setStatus("No target tab. Click the extension icon on a web page or use the context menu.", true);
      scanBtn.disabled = true;
      resetPageBtn.disabled = true;
      return;
    }

    let tab;
    try {
      tab = await chrome.tabs.get(targetTabId);
    } catch {
      originLabel.textContent = "—";
      targetOrigin = null;
      setStatus("Could not read the target tab.", true);
      scanBtn.disabled = true;
      resetPageBtn.disabled = true;
      return;
    }

    const url = tab.url ?? "";
    if (!/^https?:\/\//i.test(url)) {
      originLabel.textContent = url || "—";
      targetOrigin = null;
      setStatus("Font Switcher only works on http(s) pages.", true);
      scanBtn.disabled = true;
      resetPageBtn.disabled = true;
      return;
    }

    targetOrigin = new URL(url).origin;
    originLabel.textContent = targetOrigin;
    scanBtn.disabled = false;
    setStatus("Ready. Scan pulls combos from the live DOM (includes shadow roots).");

    await loadOverridesForOrigin();
    syncResetPageButton();
  }

  async function resetPageOverrides() {
    if (!targetOrigin || targetTabId == null) return;
    const key = storageKeyForOrigin(targetOrigin);
    await chrome.storage.local.remove(key);
    overrides = {};
    await notifyContentReload();
    setStatus(`Removed all font overrides for this origin (${targetOrigin}).`);
    await renderList();
  }

  async function loadOverridesForOrigin() {
    if (!targetOrigin) {
      overrides = {};
      return;
    }
    const key = storageKeyForOrigin(targetOrigin);
    const data = await chrome.storage.local.get(key);
    const rec = data[key];
    if (rec && rec.version === 1 && rec.overrides) overrides = { ...rec.overrides };
    else overrides = {};
  }

  async function persistOverrides() {
    if (!targetOrigin) return;
    const key = storageKeyForOrigin(targetOrigin);
    await chrome.storage.local.set({
      [key]: { version: 1, overrides: { ...overrides } },
    });
  }

  async function notifyContentReload() {
    if (targetTabId == null) return;
    try {
      await chrome.tabs.sendMessage(targetTabId, { type: EXT, action: "reloadOverrides" });
    } catch {
      /* tab may need refresh for content script */
    }
  }

  /** Reset Page is only useful when this origin has saved overrides and the tab is usable for Scan. */
  function syncResetPageButton() {
    resetPageBtn.disabled = scanBtn.disabled || Object.keys(overrides).length === 0;
  }

  function comboMatchesFilters(combo, familyQ, snippetQ) {
    const fq = familyQ.trim().toLowerCase();
    const sq = snippetQ.trim().toLowerCase();
    if (fq) {
      const hay = `${combo.family}\n${combo.familyStack}`.toLowerCase();
      if (!hay.includes(fq)) return false;
    }
    if (sq) {
      const snippets = combo.snippets ?? [];
      if (!snippets.some((s) => String(s).toLowerCase().includes(sq))) return false;
    }
    return true;
  }

  async function renderList() {
    try {
      const familyQ = filterFamily.value;
      const snippetQ = filterSnippet.value;

      const combos = lastCombos.filter((c) => comboMatchesFilters(c, familyQ, snippetQ));
      listRoot.innerHTML = "";

      if (!lastCombos.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No scan yet. Click “Scan page”.";
        listRoot.appendChild(p);
        return;
      }

      if (!combos.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No combos match your filters.";
        listRoot.appendChild(p);
        return;
      }

      const pageFamilySet = familiesFromCombos(lastCombos);
      const pageSorted = sortFamilies(pageFamilySet);

      const osSet = await getOsFontFamilySet();
      const otherSet = new Set(GENERIC_AND_COMMON_FONTS);
      for (const f of osSet) otherSet.add(f);
      for (const p of pageFamilySet) otherSet.delete(p);
      const otherSorted = sortFamilies(otherSet);

      for (const combo of combos) {
        const node = rowTpl.content.firstElementChild.cloneNode(true);
        const card = /** @type {HTMLElement} */ (node);
        card.dataset.sigid = combo.sigId;

        card.querySelector(".count").textContent = `${Number(combo.charCount ?? 0).toLocaleString()} chars`;
        card.querySelector(".combo-title").textContent = `${combo.family} · ${combo.size} · ${combo.weight} · ${combo.style}`;
        card.querySelector(".stack").textContent = combo.familyStack;

        const snipWrap = card.querySelector(".snippets");
        const snippets = (combo.snippets ?? []).slice(0, 3);
        for (const s of snippets) {
          const p = document.createElement("p");
          p.className = "snippet";
          p.textContent = s;
          snipWrap.appendChild(p);
        }

        const rep = overrides[combo.sigId];
        const familySelect = /** @type {HTMLSelectElement} */ (card.querySelector(".family-select"));
        const familyCustom = /** @type {HTMLInputElement} */ (card.querySelector(".in-family-custom"));
        const inSize = /** @type {HTMLInputElement} */ (card.querySelector(".in-size"));
        const inWeight = /** @type {HTMLInputElement} */ (card.querySelector(".in-weight"));
        const inStyle = /** @type {HTMLInputElement} */ (card.querySelector(".in-style"));

        appendFamilyOptions(familySelect, pageSorted, otherSorted);

        const initialFamily = rep?.fontFamily ?? combo.family;
        syncFamilyControls(familySelect, familyCustom, initialFamily);

        if (rep) {
          inSize.value = rep.fontSize ?? "";
          inWeight.value = rep.fontWeight ?? "";
          inStyle.value = rep.fontStyle ?? "";
        } else {
          inSize.value = combo.size;
          inWeight.value = combo.weight;
          inStyle.value = combo.style;
        }

        familySelect.addEventListener("change", () => {
          if (familySelect.value === CUSTOM_FAMILY_VALUE) {
            familyCustom.hidden = false;
            familyCustom.focus();
          } else {
            familyCustom.hidden = true;
            familyCustom.value = "";
          }
        });

        card.querySelector(".apply-btn").addEventListener("click", async () => {
          overrides[combo.sigId] = {
            fontFamily: readFamilyFromControls(familySelect, familyCustom),
            fontSize: inSize.value.trim(),
            fontWeight: inWeight.value.trim(),
            fontStyle: inStyle.value.trim(),
          };
          await persistOverrides();
          await notifyContentReload();
          syncResetPageButton();
          setStatus(`Saved override for ${combo.family} on this origin.`);
        });

        card.querySelector(".clear-btn").addEventListener("click", async () => {
          delete overrides[combo.sigId];
          await persistOverrides();
          await notifyContentReload();
          syncFamilyControls(familySelect, familyCustom, combo.family);
          inSize.value = combo.size;
          inWeight.value = combo.weight;
          inStyle.value = combo.style;
          syncResetPageButton();
          setStatus(`Cleared override for ${combo.family}.`);
        });

        listRoot.appendChild(card);
      }
    } finally {
      syncResetPageButton();
    }
  }

  async function runScan() {
    if (targetTabId == null || targetOrigin == null) return;
    setStatus("Scanning…");
    let resp;
    try {
      resp = await chrome.tabs.sendMessage(targetTabId, { type: EXT, action: "scan" });
    } catch (e) {
      setStatus(
        "Could not reach the page script. Reload the tab so the content script is injected, then scan again.",
        true,
      );
      return;
    }

    lastCombos = Array.isArray(resp?.combos) ? resp.combos : [];
    setStatus(`Found ${lastCombos.length} font combos (sorted by displayed character count).`);
    await renderList();
  }

  async function handlePendingSelectionHighlight() {
    const session = await chrome.storage.session.get(["fontSwitcherPendingSelection"]);
    if (!session.fontSwitcherPendingSelection) return;
    await chrome.storage.session.remove(["fontSwitcherPendingSelection"]);

    if (targetTabId == null) return;

    let sigResp;
    try {
      sigResp = await chrome.tabs.sendMessage(targetTabId, { type: EXT, action: "selectionSig" });
    } catch {
      return;
    }

    const sigId = sigResp?.sigId;
    if (!sigId) {
      setStatus("Select some text on the page, then use the context menu again.", true);
      return;
    }

    if (!lastCombos.length) await runScan();

    filterFamily.value = "";
    filterSnippet.value = "";
    await renderList();

    const card = listRoot.querySelector(`[data-sigid="${sigId}"]`);
    if (card) {
      card.classList.add("focus-ring");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      window.setTimeout(() => card.classList.remove("focus-ring"), 2000);
    } else {
      setStatus("Could not find that combo in the latest scan (try scanning again).", true);
    }
  }

  scanBtn.addEventListener("click", () => void runScan());
  resetPageBtn.addEventListener("click", () => void resetPageOverrides());
  optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  filterFamily.addEventListener("input", () => void renderList());
  filterSnippet.addEventListener("input", () => void renderList());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes[FontSwitcherSettings.STORAGE_KEY]) {
      FontSwitcherSettings.load().then((s) => {
        applyUiSettings(s);
        void renderList();
      });
    }

    if (!targetOrigin) return;
    const key = storageKeyForOrigin(targetOrigin);
    if (changes[key]) {
      loadOverridesForOrigin().then(() => void renderList());
    }
  });

  refreshUiSettings()
    .then(() => bindTabContext())
    .then(async () => {
      await handlePendingSelectionHighlight();
      await renderList();
    });
})();
