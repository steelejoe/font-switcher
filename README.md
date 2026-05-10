# Font Switcher

A Chromium extension (Manifest V3) that scans a web page for **font combinations** actually used in the DOM—family, size, weight, and style—and lets you **replace them per site** (per origin). Overrides persist in extension storage and are reapplied when you revisit the same origin.

## Features

- **Scan** the active tab’s live page: walks text nodes (including **open shadow roots**), groups elements by computed font signature, and sorts groups by approximate displayed character count.
- **Per-origin overrides**: each hostname gets its own saved map of replacements; use **Reset page** to clear overrides for the current origin only.
- **Toolbar**: click the extension icon on an `http`/`https` tab to open the Font Switcher window for that tab.
- **Context menu**: right-click the page (or a text selection) and choose **Font Switcher**; if you had text selected, the UI tries to scroll to the matching combo after a scan.
- **Filters** by font name / stack or by sample text snippet from the scan.
- **Replacement controls** per combo: family (dropdown with “seen on page” fonts, common system stacks, optional **Custom…**, plus **local fonts** when the browser supports [Local Font Access](https://developer.mozilla.org/en-US/docs/Web/API/Local_Font_Access_API)), plus size, weight, and style.
- **Options** (extension options page): toggle showing the full computed `font-family` stack on each card.

Restricted URLs (`chrome://`, `chrome-extension://`, `edge://`, etc.) are ignored on purpose.

## Install (load unpacked)

1. Clone this repository.
2. Open Chromium/Chrome/Edge → **Extensions** → enable **Developer mode**.
3. **Load unpacked** and select the repository root (the folder that contains `manifest.json`).

## Usage

1. Open a normal website tab.
2. Click the **Font Switcher** toolbar icon **or** use the page context menu entry **Font Switcher**.
3. Click **Scan page** to refresh the list of font combos.
4. Adjust family/size/weight/style for a row and click **Apply**; the page updates immediately via injected CSS. **Clear** removes the override for that signature only.

If scanning fails with a message about not reaching the page script, **reload the tab** once so the content script is injected, then scan again.

## Permissions

| Permission    | Why |
|---------------|-----|
| `storage`     | Persist per-origin overrides and global options. |
| `contextMenus` | “Font Switcher” entry on the page context menu. |
| `tabs`        | Resolve the target tab, send messages to the content script, and open the UI. |

Local font enumeration uses the browser’s optional Local Font Access API when available; grant it in the browser if you want those families in the picker.

## Project layout

```
manifest.json          # MV3 manifest
src/
  background.js        # Service worker: popup window, context menu, target tab
  content/content.js   # Scan, tagging, override CSS injection, mutation observer
  ui/
    app.html / app.js / app.css   # Main Font Switcher window
    options.html / options.js     # Options page
    settings.js                   # Shared settings helper
```

## License

This project is licensed under the MIT License—see [LICENSE](LICENSE).
