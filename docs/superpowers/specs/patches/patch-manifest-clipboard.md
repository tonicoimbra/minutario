## PATCH 1: Replace "Permissions (manifest.json)" section

```json
{
  "manifest_version": 3,
  "name": "MacroBlaze",
  "version": "1.0.0",
  "description": "Expand text shortcuts into rich HTML templates in Word Online.",
  "permissions": ["storage", "clipboardWrite", "clipboardRead"],
  "host_permissions": [
    "https://word.live.com/*",
    "https://*.officeapps.live.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "MacroBlaze"
  },
  "content_scripts": [
    {
      "matches": [
        "https://word.live.com/*",
        "https://*.officeapps.live.com/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "dashboard/dashboard.html",
        "dashboard/dashboard.js",
        "dashboard/dashboard.css"
      ],
      "matches": [
        "https://word.live.com/*",
        "https://*.officeapps.live.com/*"
      ]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Note: `popup/popup.js` opens the dashboard via `chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') })`.

---

## PATCH 2: Replace clipboard line in "Insertion approach" step 3

OLD: 3. Copies the template HTML to the system clipboard via `navigator.clipboard.writeText` / `ClipboardItem`.

NEW: 3. Copies the template HTML to the system clipboard via `navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])`.
