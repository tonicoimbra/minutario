## PATCH 1: Add "Shortcut Rules" subsection
[location: insert after the "No match" bullet in Trigger Mechanism]
### Shortcut Rules

- **Normalization:** Shortcut matching is case-insensitive. Shortcuts are stored in lowercase and compared in lowercase at runtime.
- **Allowed characters (v1):** `a-z`, `0-9`, and hyphen (`-`) only.
- **Validation location:** The dashboard Shortcut field validates input as the user types and shows an inline error for invalid characters.
- **Maximum length:** Shortcut length is limited to 30 characters (excluding the trigger character).
- **Duplicate handling:** Duplicate shortcuts are rejected at save time. The save action must fail with a specific error message naming the conflicting template, for example: `Atalho já em uso pelo template "Contrato de Serviço".`
- **Unicode scope:** Unicode and emoji shortcuts are out of scope for v1 and must be rejected by validation.

---

## PATCH 2: Add "Popup Acceptance Criteria" subsection
[location: replace or expand the current Popup paragraph under Dashboard UI]
### Popup Acceptance Criteria

- Clicking a recent template quick-launch button copies that template content to the clipboard and shows a `Copiado!` confirmation for 1.5 seconds.
- Quick-launch copy does not switch tabs and does not automatically focus Word Online.
- The recent list is updated after every successful paste in the content script.
- Update flow for recents: content script sends a message to background, and background writes to `chrome.storage.local` key `recent`.
- `recent` stores an array of template IDs.
- `recent` is deduplicated with newest-first ordering and capped at 3 items.
- If fewer than 3 recent templates exist, the popup shows only the available items.
