# Message Bubble AMC Mimic — Design

Date: 2026-08-22
Status: Approved (owner: 直接实现)
Scope: Mimic AMC message bubbles & action rail in Gemini Nexus with native CSS translation, keep existing thoughts/tool logic.

## 1. Goal & Non-Goals
- Goal: Visual parity with `AMC/src/components/message/Message.tsx` for bubble shape, spacing, and hover actions. User bubble → rounded-2xl, model bubble → transparent full-width. Action rail sticky, hover-reveal on desktop, always visible on touch.
- Non-Goals: No data-model change, no Tailwind introduction, no rewrite of `thoughts_block` / `tool-disclosure`. Grouping uses existing `message_spacing.js` (`msg-grouped`/`msg-compact-chain`); AMC's 5-min `isGrouped` deferred.
- Success: Side-by-side screenshot indistinguishable for bubble radius/shadow/spacing; hover actions match AMC timing (opacity 80→100, translate-y-1, duration 200-300ms).

## 2. Architecture
- Entry: `sandbox/render/message.js:appendMessage(container, text, role, attachment, thoughts, sources, options)` stays canonical.
- Rendering: `renderContent` (markdown → HTML → `enhanceLiveArtifacts`) untouched. Outer wrapper `msg` + `msg-row` + `message-action-rail` + `message-content-container` preserved.
- Styling: `css/chat.css` is single source of truth. Translate AMC Tailwind tokens to CSS vars:
  - `--bg-user-msg` ← `var(--theme-bg-user-message)` (#eef)
  - `--border-color` ← `var(--theme-border-secondary)` with 30% alpha
  - `--radius-md` → 16px for user bubble, 12px for model cards
  - `--shadow-sm` for card-shadow
- Icons: `sandbox/ui/templates/icons.js` adds `EDIT3, REFRESH_CW, MORE_HORIZONTAL, TRASH2, GIT_BRANCH, CIRCLE_PLAY` as inline SVG (lucide stroke 2), no new deps.

## 3. Components & Changes
### 3.1 css/chat.css
- `.msg.user .message-content-container`: `w-fit max-w-[80%] px-5 py-4 (14→16 on sm) rounded-2xl border 1px solid color-mix(...30%) shadow-sm` (was `14px 18px` + `radius-md 4px`).
- `.msg.ai .message-content-container`: `w-full py-0 bg:transparent border:none shadow:none` (keep).
- `.message-content-container`: add `max-w: min(64rem, calc(100% - 2.5rem))` for model, `80%` for user via `CHAT_USER_MESSAGE_INSET_CLASS` translation.
- `.message-action-rail`: `flex 0 0 40px w-40px sticky top-4 self-start z-10` (AMC: `w-8 sm:w-10 sticky top-2 sm:top-4`).
- `.message-actions`: `flex-col gap-1 mt-1 p-1.5 rounded-lg hover:bg-tertiary` with `opacity 80→100` and `translate-y-1` hidden on `@media (hover:hover) and (pointer:fine)` (already present, tune duration 200ms).
- `.message-avatar`: `29px` (AMC `useResponsiveValue(24,29)`), `rounded-full`, hover edit overlay (optional phase 2).
- Grouping: `#chat-history > :not([hidden]) + :not([hidden]) {mt-6}` vs `+ .msg.msg-grouped {mt-1.5}` already matches AMC; keep.

### 3.2 sandbox/render/message.js
- `createMessageActionRail(role)`: set `rail.className='message-action-rail'` and `actions.className='message-actions'` with AMC classes `p-1.5 rounded-lg text-tertiary hover:text-primary hover:bg-tertiary opacity-80 hover:opacity-100 transition-all duration-200`.
- `createCopyButton`: add `actionButtonClasses` constant and set `button.className='copy-btn'` plus AMC hover styles; keep `TemplateIcons.COPY` (align with `MessageCopyButton`).
- `appendMessage` for `role=user` keeps `editController.button` appended to actionsHost; ensure `copyBtn` and `editBtn` share same `actionButtonClasses`.
- Optional (phase 1 stub): Add `MoreHorizontal` overflow placeholder (no menu logic) to reserve layout parity.

### 3.3 sandbox/ui/templates/icons.js
- Add icons if not present: `EDIT3`, `REFRESH_CW`, `MORE_HORIZONTAL`, `TRASH2` (already has TRASH), `GIT_BRANCH`. Use stroke 2, size 16.

## 4. Data Flow
- `MessageHandler` → `appendMessage` → `renderContent` → `enhanceLiveArtifacts` → `syncCopyButton` → `syncMessageSpacing`. No new store; `options.isGrouped` derived from existing `getMessageSpacingKind`; future AMC `isGrouped` (5min same-role) can be injected via `options.prevMessage`.

## 5. Error Handling
- CSS vars fallback to existing `var(--bg-user-msg)` if theme var missing.
- Avatar image fail → hide, keep initials fallback (user SVG).
- Copy button clipboard fail → `console.error`, no UI break.

## 6. Testing
- Update `css/chat_layout.test.js`: assert `rounded-2xl` (or `border-radius: 16px`) and `max-width: 80%` for user bubble; keep existing hover opacity assertions.
- Update `sandbox/render/message.test.js`: expect `message-action-rail` 40px, `copy-btn` has `p-1.5` class, user row children order `contentHost` before `actionsHost`.
- Visual: manual side-by-side of AMC vs Nexus for `user`/`model`/`grouped` states, light/dark, mobile (≤600px) `max-width 80%` preserved.
- No change to `sandbox/render/artifacts.test.js` except icon additions.

## 7. Rollout
- Phase 1 (this spec): CSS skin + action rail polish (A approach). Build `vite build` + `package-extension.mjs`, manual QA.
- Phase 2 (optional): Full `MessageActions` overflow (continue/fork/export/delete) as follow-up spec.

## 8. Risks
- Tailwind → CSS translation mismatch for `card-shadow`; mitigate by mapping to `var(--shadow-sm)`.
- Touch vs hover parity: keep existing `@media (hover:hover)` logic, already matches AMC.
