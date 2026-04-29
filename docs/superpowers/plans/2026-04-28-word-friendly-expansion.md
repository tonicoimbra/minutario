# Word-Friendly Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MacroBlaze expand templates into Word Online with more predictable formatting and place the caret at the exact end of the inserted content.

**Architecture:** Keep Quill HTML as the editable source of truth, but normalize it into a small Word-friendly subset at expansion time. Replace the shortcut with a controlled DOM fragment, then explicitly collapse the selection at the true end of the inserted content.

**Tech Stack:** Chrome Extension MV3, vanilla JavaScript, DOM Range/Selection APIs, jsdom with Node test runner

---

### Task 1: Add Red Tests For Normalization And Caret Placement

**Files:**
- Modify: `tests/content.test.js`
- Test: `tests/content.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test("normalizes Quill-flavored HTML into a word-friendly subset", () => {
  // Expect div/span/class-heavy HTML to become p/strong/em/u/br/ul/ol/li/a/text only.
});

test("places caret at the exact end of inserted block content", () => {
  // Expand multi-paragraph content and assert the selection is collapsed at the end.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because normalization and end-caret helpers are not implemented.

- [ ] **Step 3: Write minimal implementation**

```js
// Add exported helpers on MacroBlazeContent:
// normalizeTemplateHtml(html)
// getCaretTextOffset(root, selection)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for the new tests.

- [ ] **Step 5: Commit**

```bash
git add tests/content.test.js content.js
git commit -m "test: cover word-friendly expansion"
```

### Task 2: Normalize Template HTML Before Expansion

**Files:**
- Modify: `content.js`
- Test: `tests/content.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("preserves paragraphs, inline emphasis, and lists during expansion", () => {
  // Expand content containing p, strong, em, u, ul, ol, li, and links.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because expansion still inserts raw editor HTML.

- [ ] **Step 3: Write minimal implementation**

```js
function normalizeTemplateHtml(doc, html) {
  // Parse HTML
  // Walk nodes
  // Keep only allowed block and inline tags
  // Drop classes/styles/data attributes
  // Rewrite div to p where needed
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS with normalized output.

- [ ] **Step 5: Commit**

```bash
git add content.js tests/content.test.js
git commit -m "feat: normalize template html for word"
```

### Task 3: Insert The Normalized Fragment And Reposition Caret

**Files:**
- Modify: `content.js`
- Test: `tests/content.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("collapses selection at the end of the inserted fragment", () => {
  // Expand multi-node content and assert selection.toString() === "" and offset is final.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because caret can stop after an arbitrary last node or in the middle of content.

- [ ] **Step 3: Write minimal implementation**

```js
function placeCaretAtEndOfRange(doc, insertedNodes) {
  // Find deepest last text position in the inserted fragment
  // Collapse selection there
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS with caret at exact end.

- [ ] **Step 5: Commit**

```bash
git add content.js tests/content.test.js
git commit -m "fix: place caret at end of expansion"
```

### Task 4: Final Verification

**Files:**
- Modify: `content.js`
- Modify: `tests/content.test.js`

- [ ] **Step 1: Run full automated verification**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run syntax verification**

Run: `node --check content.js && node --check background.js && node --check popup/popup.js && node --check dashboard/dashboard.js`
Expected: no output, exit 0

- [ ] **Step 3: Commit**

```bash
git add content.js tests/content.test.js docs/superpowers/plans/2026-04-28-word-friendly-expansion.md
git commit -m "feat: improve word template expansion"
```
