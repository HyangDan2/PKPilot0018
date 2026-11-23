# Stage 3 — workspace arrangements, focus drawer, output menu

Sigrún's Stage 3 turns the single stacked shell into three desktop arrangements while keeping the
Phase 1 shell available as **Classic**. This note records what was built, where it lives, and how it
is verified.

## The three arrangements

| id | Layout | Controls |
| --- | --- | --- |
| `tri` (default) | `[ Navigator ][ Output ][ Worksheet ]` | navigator splitter, output/worksheet splitter |
| `focus` | `[ Navigator ][ Output ]` + worksheet drawer sliding in from the right | drawer edge (width), drawer close/tab |
| `classic` | `[ Navigator ]` + output stacked over worksheet | stacked splitter (the Phase 1 shell) |

Switches live in three places, all wired to the same state: the toolbar segmented control
(`data-testid="ws-layout-tri|focus|classic"`), `View ▸ Workspace layout`, and the `⋮` menu.
The four older emphasis presets (`Balanced`, `Worksheet focus`, `Results & charts focus`,
`Full focus`) are kept and now act on whichever arrangement is on screen: in three-panel mode they
change the output column width, in Classic they change the stacked split.

Widths are clamped so no column collapses: navigator 180–430 px, output ≥ 320 px,
worksheet ≥ 340 px, drawer 320–960 px (also ≤ viewport − 200).

## Persistence

`localStorage["sigrun.workspace.v1"]`

```json
{ "layout": "tri", "navW": 254, "outputW": 520, "outputH": 52, "drawerW": 460, "drawerOpen": false }
```

`readWorkspace` / `normalizeWorkspace` repair missing, malformed or out-of-range records, and a
blocked storage (private mode, quota) silently keeps the defaults. Widths are re-clamped against
the live viewport on load and on every window resize.

## Responsive behaviour

| Window width | What is painted |
| --- | --- |
| ≥ 1200 px | the stored arrangement (`tri` keeps three columns) |
| 1024–1199 px | `tri` folds back to `classic` automatically; the stored choice is unchanged |
| < 1024 px | the existing tabbed phone/tablet shell (output/worksheet tabs, navigator drawer) |

## Focus mode drawer

- Opens automatically when focus mode is picked; closes with the head `×` and reopens from the
  vertical edge tab (`data-testid="drawer-toggle"`).
- The left edge (`data-testid="drawer-resize"`) resizes it; the keyboard arrows do too.
- The drawer contains the same `WorksheetGrid`: editing, selection model, copy/cut/paste, the full
  right-click menus, and the worksheet tabs — so nothing behaves differently inside it.
- The head carries a one-click **rerun** (`data-testid="drawer-rerun"`) that repeats the last
  analysis against the edited sheet without opening the dialog, plus detach and close.

## Output panel right-click menu

Card (`[data-testid=out-card]`) menu: copy results as text, copy chart image (PNG), save chart image
(PNG), export the table (CSV), rerun analysis with current data, reproduce from the card's snapshot,
collapse/expand, delete. Empty output area: copy every result as text, collapse all, expand all.
The menu is body-portalled, kept inside the viewport (flips/clamps near the edges), closes on `Esc`,
outside click, scroll and resize, and is keyboard-navigable (`↑`/`↓`).

## Files

- `src/lib/workspace.ts` — layout model, width math, storage (React-free, unit-tested)
- `src/App.tsx` — arrangement rendering, splitters, drawer, persistence effects
- `src/components/OutputPanel.tsx` — card/area context menu, `cardText()`, clipboard text helper
- `src/components/Toolbar.tsx`, `MenuBar.tsx`, `Header.tsx` — the three switches
- `src/styles/app.css` — `.ws-tri`, `.focus-main`, `.ws-drawer`, `.ws-switch`
- `tests/workspace-stage3.test.ts` — 15 unit tests
- `tools/e2e_stage3.cjs` — 15 browser scenarios × 1366×768 and 1920×1080

## Verification

```bash
npx tsc --noEmit
npm test              # 583 unit tests
npm run qa:stats      # 156/156 against the NumPy/SciPy/statsmodels reference
npm run build
node tools/e2e_stage3.cjs                 # 141 checks at both resolutions + screenshots
node tools/e2e_stage1.cjs                 # Stage 1 regression (selection, menus, + column)
node tools/e2e_stage2.cjs                 # Stage 2 regression (scatter Y×X, pairs, groups, reopen)
```

Report screenshots: `work/pkpilot0018/stage3-3panel-pc.png` (1920×1080 three-panel),
`work/pkpilot0018/stage3-drawer-pc.png` (focus drawer), `work/pkpilot0018/stage3-3panel-1366.png`.
