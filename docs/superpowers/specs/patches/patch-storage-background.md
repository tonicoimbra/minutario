## PATCH 1: Add "Background Message Contract" subsection
[location: insert after the Architecture table, before "Insertion approach" heading]
### Background Message Contract

`background.js` is the single message router between popup, dashboard, and content scripts. All cross-tab actions use explicit typed messages.

```ts
interface OpenDashboardMessage {
  type: "OPEN_DASHBOARD";
  payload?: {
    source?: "popup" | "content" | "dashboard";
    focusExisting?: boolean; // default true
  };
}

interface GetTemplatesMessage {
  type: "GET_TEMPLATES";
  payload?: {
    folderId?: string | null;
    query?: string;
  };
}

type BackgroundMessage = OpenDashboardMessage | GetTemplatesMessage;

interface BackgroundOkResponse<T> {
  ok: true;
  data: T;
}

interface BackgroundErrorResponse {
  ok: false;
  error: string;
}
```

- `OPEN_DASHBOARD`: opens the dashboard tab via `chrome.tabs.create`; if `focusExisting` is true and a dashboard tab already exists, focus that tab instead of creating duplicates.
- `GET_TEMPLATES`: returns filtered templates loaded from `chrome.storage.sync` keys matching `tpl_*`, optionally filtered by `folderId` and `query`.

Storage migration state is tracked in `chrome.storage.local` under key `storageVersion`.

```ts
const STORAGE_VERSION_KEY = "storageVersion";
const CURRENT_STORAGE_VERSION = 1;
```

Migration protocol:
1. On background service worker startup, read `storageVersion` from `chrome.storage.local` (default `0` when missing).
2. If stored version is lower than `CURRENT_STORAGE_VERSION`, run incremental migrations in order (`1`, `2`, `3`, ...).
3. Each migration must be idempotent and scoped (read current data, transform only required keys, write back).
4. After all migrations succeed, write `storageVersion = CURRENT_STORAGE_VERSION` to mark completion.

Failure behavior:
- On migration error, log structured details with `console.error` (migration step, key, exception).
- Leave existing user data intact; never delete, overwrite with empty values, or silently discard data on failure.
- Return an error response for dependent messages while keeping extension UI responsive (user can retry after restart/update).

---

## PATCH 2: Add "Quota Handling" subsection
[location: insert after the "Why one key per template" paragraph in Data Model]
### Quota Handling

Before saving any template, the extension must validate both per-key and total sync quota.

1. Pre-save per-key check:
- Serialize the candidate template: `const raw = JSON.stringify(template)`.
- Compute byte length with UTF-8 semantics (for example, `new TextEncoder().encode(raw).length`).
- If byte length exceeds the per-key limit (`8192` bytes), block save and show error state.

2. Total quota check before write:
- Read all `tpl_*` keys plus `folders` and `settings` from `chrome.storage.sync`.
- Estimate new total bytes after replacing/adding the candidate template.
- Compare against total sync quota (`102400` bytes).
- If projected total exceeds quota, block save and show error state.

3. User-facing overflow feedback:
- Show a non-blocking toast error (editor remains open, no data loss in form state).
- Toast includes byte counts, e.g. `Template size: 9,340 / 8,192 bytes` or `Projected storage: 106,500 / 102,400 bytes`.

4. Guidance text in error/toast:
- `Delete old templates or shorten template content to save space.`
- This guidance must be shown whenever save is blocked by quota limits.
