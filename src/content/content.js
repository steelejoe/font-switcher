(() => {
  const EXT = "fontSwitcher";
  const STYLE_ID = "font-switcher-injected-style";
  const DATA_ATTR = "data-fs-sig";

  /** After reloading the extension, old content scripts keep running but `chrome.*` APIs fail. */
  function isExtensionContextValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  let debounceTimer = 0;
  /** @type {MutationObserver | null} */
  let mutationObserver = null;

  function teardownIfExtensionDead() {
    if (isExtensionContextValid()) return false;
    try {
      mutationObserver?.disconnect();
    } catch {
      /* noop */
    }
    mutationObserver = null;
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
      debounceTimer = 0;
    }
    return true;
  }

  function storageKeyForOrigin(origin) {
    return `${EXT}:${encodeURIComponent(origin)}`;
  }

  function primaryFamily(computedFamily) {
    const first = computedFamily.split(",")[0]?.trim() ?? "";
    return first.replace(/^["']|["']$/g, "");
  }

  function normalizeWeight(w) {
    if (w === "normal") return "400";
    if (w === "bold") return "700";
    const n = parseInt(w, 10);
    return Number.isFinite(n) ? String(n) : w;
  }

  function normalizeStyle(s) {
    return s === "oblique" ? "oblique" : s;
  }

  function tupleFromComputed(cs) {
    return {
      family: primaryFamily(cs.fontFamily),
      familyStack: cs.fontFamily,
      size: cs.fontSize,
      weight: normalizeWeight(cs.fontWeight),
      style: normalizeStyle(cs.fontStyle),
    };
  }

  function sigKey(tuple) {
    return JSON.stringify({
      f: tuple.family,
      s: tuple.size,
      w: tuple.weight,
      st: tuple.style,
    });
  }

  function sigIdFromTuple(tuple) {
    const key = sigKey(tuple);
    let h = 5381;
    for (let i = 0; i < key.length; i++) {
      h = (h * 33) ^ key.charCodeAt(i);
    }
    return `fs${(h >>> 0).toString(16).padStart(8, "0")}`;
  }

  function isProbablyVisible(el) {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }

  function snippetFromText(text, maxLen = 96) {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return t;
    return `${t.slice(0, maxLen - 1)}…`;
  }

  /** Length of visible text for one DOM text node (collapse whitespace, trim). */
  function displayedCharLength(raw) {
    return raw.replace(/\s+/g, " ").trim().length;
  }

  /** @param {Node} root */
  function walkTextNodes(root, visit) {
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        visit(node);
        return;
      }
      if (node.nodeType === Node.DOCUMENT_NODE) {
        const doc = /** @type {Document} */ (node);
        if (doc.documentElement) walk(doc.documentElement);
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {Element} */ (node);
        if (el.shadowRoot) walkTextNodes(el.shadowRoot, visit);
        for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
      } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        const frag = /** @type {DocumentFragment} */ (node);
        for (let c = frag.firstChild; c; c = c.nextSibling) walk(c);
      }
    }
    walk(root);
  }

  function collectScan() {
    const sigToElements = new Map();
    const sigToCharCount = new Map();
    const sigToSnippets = new Map();

    function noteSnippet(sigId, text) {
      const s = snippetFromText(text);
      if (!s) return;
      let arr = sigToSnippets.get(sigId);
      if (!arr) {
        arr = [];
        sigToSnippets.set(sigId, arr);
      }
      if (arr.includes(s)) return;
      if (arr.length >= 3) return;
      arr.push(s);
    }

    function visitText(textNode) {
      const raw = textNode.nodeValue ?? "";
      if (!raw || !/\S/.test(raw)) return;
      const el = textNode.parentElement;
      if (!el || !isProbablyVisible(el)) return;

      const tuple = tupleFromComputed(getComputedStyle(el));
      const sid = sigIdFromTuple(tuple);

      let set = sigToElements.get(sid);
      if (!set) {
        set = new Set();
        sigToElements.set(sid, set);
      }
      set.add(el);

      const chars = displayedCharLength(raw);
      sigToCharCount.set(sid, (sigToCharCount.get(sid) ?? 0) + chars);

      el.setAttribute(DATA_ATTR, sid);
      noteSnippet(sid, raw);
    }

    const root = document.documentElement || document;
    walkTextNodes(root, visitText);

    /** @type {Array<{ sigId: string; family: string; familyStack: string; size: string; weight: string; style: string; charCount: number; snippets: string[] }>} */
    const combos = [];

    for (const [sigId, els] of sigToElements) {
      const sampleEl = els.values().next().value;
      if (!sampleEl) continue;
      const tuple = tupleFromComputed(getComputedStyle(sampleEl));
      combos.push({
        sigId,
        family: tuple.family,
        familyStack: tuple.familyStack,
        size: tuple.size,
        weight: tuple.weight,
        style: tuple.style,
        charCount: sigToCharCount.get(sigId) ?? 0,
        snippets: sigToSnippets.get(sigId) ?? [],
      });
    }

    combos.sort((a, b) => b.charCount - a.charCount);
    return combos;
  }

  function cssEscapeIdent(value) {
    return CSS.escape(value);
  }

  function formatFontFamilyForCss(userValue) {
    const parts = userValue.split(",").map((p) => p.trim()).filter(Boolean);
    return parts
      .map((p) => {
        if (/^["'].*["']$/.test(p)) return p;
        if (/[\s"'\\/,]/.test(p) || !/^[\w\-]+$/.test(p)) {
          return `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        }
        return p;
      })
      .join(", ");
  }

  function buildOverrideCss(overrides) {
    let css = "";
    for (const [sigId, rep] of Object.entries(overrides)) {
      const sel = `[${DATA_ATTR}="${cssEscapeIdent(sigId)}"]`;
      const ff = formatFontFamilyForCss(rep.fontFamily);
      css += `${sel}{font-family:${ff}!important;font-size:${rep.fontSize}!important;font-weight:${rep.fontWeight}!important;font-style:${rep.fontStyle}!important;}`;
    }
    return css;
  }

  async function loadOverridesRecord() {
    if (teardownIfExtensionDead()) return {};
    try {
      const origin = location.origin;
      const key = storageKeyForOrigin(origin);
      const data = await chrome.storage.local.get(key);
      const rec = data[key];
      if (!rec || rec.version !== 1 || !rec.overrides) return {};
      return rec.overrides;
    } catch {
      teardownIfExtensionDead();
      return {};
    }
  }

  function injectStyle(cssText) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = cssText;
  }

  async function applyOverridesFromStorage() {
    if (teardownIfExtensionDead()) return;
    try {
      const overrides = await loadOverridesRecord();
      injectStyle(buildOverrideCss(overrides));
    } catch {
      teardownIfExtensionDead();
    }
  }

  /** @param {Node} root */
  function tagSubtree(root) {
    walkTextNodes(root, (textNode) => {
      const raw = textNode.nodeValue ?? "";
      if (!raw || !/\S/.test(raw)) return;
      const el = textNode.parentElement;
      if (!el || !isProbablyVisible(el)) return;

      const tuple = tupleFromComputed(getComputedStyle(el));
      const sid = sigIdFromTuple(tuple);
      el.setAttribute(DATA_ATTR, sid);
    });
  }

  function scheduleRetagAndApply() {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      debounceTimer = 0;
      if (teardownIfExtensionDead()) return;
      tagSubtree(document.documentElement || document);
      await applyOverridesFromStorage();
    }, 120);
  }

  function getSigFromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const node = sel.anchorNode;
    if (!node) return null;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);
    if (!el || !isProbablyVisible(el)) return null;
    const tuple = tupleFromComputed(getComputedStyle(el));
    return sigIdFromTuple(tuple);
  }

  mutationObserver = new MutationObserver((records) => {
    if (!isExtensionContextValid()) {
      teardownIfExtensionDead();
      return;
    }
    let touched = false;
    for (const r of records) {
      if (r.type === "childList" && r.addedNodes.length > 0) {
        touched = true;
        break;
      }
    }
    if (touched) scheduleRetagAndApply();
  });

  function startObserver() {
    const root = document.body;
    if (!root) {
      document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      return;
    }
    if (!mutationObserver || !isExtensionContextValid()) return;
    // Observe body only so updates to our injected <style> in <head> do not retrigger this observer
    // (that caused apply → DOM mutation → observe → apply loops and visible font flicker).
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== EXT) return undefined;

    if (!isExtensionContextValid()) {
      teardownIfExtensionDead();
      if (msg.action === "scan") sendResponse({ combos: [] });
      else if (msg.action === "selectionSig") sendResponse({ sigId: null });
      else if (msg.action === "reloadOverrides") sendResponse({ ok: false, error: "Extension context invalidated" });
      return undefined;
    }

    if (msg.action === "scan") {
      sendResponse({ combos: collectScan() });
      return undefined;
    }

    if (msg.action === "selectionSig") {
      sendResponse({ sigId: getSigFromSelection() });
      return undefined;
    }

    if (msg.action === "reloadOverrides") {
      applyOverridesFromStorage()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: "Extension context invalidated or storage failed" }));
      return true;
    }

    return undefined;
  });

  applyOverridesFromStorage()
    .then(startObserver)
    .catch(() => {
      teardownIfExtensionDead();
    });
})();
