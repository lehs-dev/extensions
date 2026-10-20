# Project: GNOME 51 Extensions Performance & macOS Sequoia UX

Implementation resumed and hardened on 2026-10-16. See [verification and desktop acceptance status](GNOME_51_SEQUOIA_STATUS.md) for the current result; historical teamwork gates under `.agents/` describe the earlier run.

## Architecture
- **Workspace Root**: `/workspaces/extensions`
- **Target Platform**: GNOME Shell 51 (Mutter 51 Wayland session, 60Hz/120Hz frame pacing, Cogl.Snippet fragment shaders)
- **10 Extensions**:
  1. `blur-my-shell@custom` — Screen/overview/window blur using Cogl.Snippet fragment shaders.
  2. `clipboard-history@custom` — Async clipboard storage with Gio and native GJS migration.
  3. `compiz-alike-magic-lamp-effect@custom` — Clutter.DeformEffect mesh genie window minimization/restoration.
  4. `dash2dock-lite@custom` — macOS-style dock with magnified icons, centered expansion, and Cogl.Snippet shaders.
  5. `just-perfection-desktop@custom` — Shell customization, UI toggles, GNOME 51 chrome compatibility.
  6. `kimpanel@custom` — Input method panel with DBus lifecycle.
  7. `light-style@custom` — GNOME 51 color scheme switcher.
  8. `spotlight@custom` — Compact floating search panel with search stealer and transparent outside-click surface.
  9. `static-workspace-background@custom` — Fixed wallpaper during workspace switch transitions.
  10. `tiling-assistant@custom` — Window snap presets (halves, quarters, 1/3-2/3), native window corners, gap coordination.

## Overview appearance

`static-workspace-background@custom` also provides a full-screen
wallpaper in Overview. Minimized window previews fade at their Overview slots;
the first Super press shows the native workspace strip above the window picker.
The thumbnails are 15% smaller, sit 8 logical pixels below the panel, and have
a translucent background starting at half the primary monitor's work-area
width. The background stays centered and grows equally to both sides with
the workspace count. At full width, thumbnails shrink to fit the strip,
including theme spacing and selection chrome.
The strip slides down from the panel with Overview progress, including gesture
reversals, and shares the app grid's 24 px corner radius.
Only the active workspace's windows appear at rest. App-grid transitions keep
the picker layout fixed and fade its windows in place, while workspace swipes
and window dragging retain native visibility and navigation.
The app grid uses a separate centered panel with a white tint at 20% opacity,
slightly denser than the tiling preview. Layout hooks compose with Just
Perfection, and disabling the extension restores the previous methods and
workspace background opacity. See the extension's README for loading and
desktop verification.

Just Perfection's Desktop startup preference intercepts GNOME's startup
Overview animation. If extension loading overlaps an animation already in
progress, it suppresses that view and completes the native hide cleanup after
the first allocation. Normal Overview access remains available after login.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Dash2Dock Lite Cosine Bell Curve | Refine magnification to follow smooth continuous raised cosine bell curve $0.5 \times (1 - \cos(\pi p))$ | M1 | ORIGINAL_REQUEST § R2 |
| 2 | Magic Lamp Dynamic Dock Target | Coordinate Compiz Magic Lamp minimize/unminimize trajectory with dynamic Dash2Dock Lite icon coordinates | M1 | ORIGINAL_REQUEST § R2 |
| 3 | Tiling Assistant 1/3 & 2/3 Presets | Harmonize Tiling Assistant with macOS Sequoia-style 1/3 and 2/3 window snap presets | M2 | ORIGINAL_REQUEST § R3 |
| 4 | Native Window Corners & Gaps | Leave window corner shape to applications and GNOME; support panel-aware screen gaps and configurable edges | M2 | User feedback 2026-10-17 |
| 5 | Spotlight Compact Panel | Compact light/dark popup with transparent outside-click surface; full-screen blur/dim removed per user feedback | M2 | User feedback 2026-10-16 |
| 6 | Spotlight Instant Typing & Navigation | Eliminate input latency (<16ms, synchronous focus grab) and add keyboard navigation (arrows) | M2 | ORIGINAL_REQUEST § R3 |
| 7 | Fixed Wallpaper Swipe | Keep workspace wallpaper stationary during multi-touch swipe transitions | M2 | ORIGINAL_REQUEST § R3 |
| 8 | Formatting & Git Hygiene | Clean trailing whitespace in `tilingPopup.js:223, 226` so `git diff --check` passes | M2 | Survey (explorer_survey_3) |
| 9 | Comprehensive Test Suite & Acceptance | Automated regression, native GJS, schema and formatting results recorded in the status report; desktop acceptance pending | M3 | ORIGINAL_REQUEST § AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | macOS Sequoia Dock & Window Animations (R2) | Cosine bell, compositor frame clock, dynamic dock icon coordinates, Sequoia defaults and theme integration | none | IMPLEMENTED |
| M2 | macOS Sequoia Tiling, Spotlight, Spaces & Hygiene (R3 & AC) | Accessible thirds presets, native window corners, coordinated gaps, Spotlight blur/focus/lifecycle, fixed wallpaper and formatting | none | IMPLEMENTED |
| M3 | Final Acceptance & Adversarial Hardening (All ACs) | Automated regression, native Gio, syntax/schema-cache and formatting checks; hardware latency/frame pacing and visual desktop acceptance | M1, M2 | AUTOMATED PASS 2026-10-17 (159/159); DESKTOP PENDING |

## Interface Contracts

### Dash2Dock Lite ↔ Compiz Magic Lamp
- **Integration Hook**: `dash2dock-lite/integrations.js` `compiz_getIcon(actor)`
- **Output Contract**:
  ```javascript
  {
    x: number,          // Absolute screen X coordinate of target app icon
    y: number,          // Absolute screen Y coordinate of target app icon
    width: number,      // Width of target app icon bounding box (> 0)
    height: number,     // Height of target app icon bounding box (> 0)
    monitorIndex: number,
    dockPosition: 'bottom' | 'top' | 'left' | 'right'
  }
  ```
- **Magic Lamp Contract**: `this.toTheBorder = false;` in `compiz-alike-magic-lamp-effect/extension.js`. Use the received `icon.x, icon.y, icon.width, icon.height` to compute vertex deformation trajectory toward the actual dock icon.

### Tiling Assistant screen gaps
- **Work Area Contract**: Use GNOME's monitor work area, including any existing panel or dock struts. Window Gap has been removed.
- **Inner Gap Contract**: Tiling Assistant applies `windowGap / 2` between adjacent tiles and respects `singleScreenGap` at outer boundaries.
- **Panel Edge Gap**: Uniform screen gaps use `panel-edge-gap` (default 0) only beside the visible panel on its actual monitor. Displays without a panel keep the uniform gap. Custom screen edges support four independent values, scoped to panel displays by default; legacy custom settings retain their previous scope. Tile, preview and resize share the same effective gaps.
- **Window Corners**: Applications and GNOME determine window corner shape; Tiling Assistant does not attach a rounding shader. Normal tile edge constraints and partial maximization are restored after removing the corner-preserving workaround.
- **Snap Presets**: Halves (50%), Quarters (25%), Left/Right Third (33.33%), Left/Right Two-Thirds (66.67%), Center Third (33.33%).

## Code Layout
- `dash2dock-lite@custom/` — Owned by M1 (`animator.js`, `integrations.js`, `effects/easing.js`)
- `compiz-alike-magic-lamp-effect@custom/` — Owned by M1 (`extension.js`)
- `tiling-assistant@custom/` — Owned by M2 (`src/extension/tilingWindowManager.js`, `src/extension/layoutPicker.js`, `src/extension/tilingPopup.js`, schemas)
- `spotlight@custom/` — Owned by M2 (`lib/popup/widget/spotlightPopup.js`, `lib/popup/components/positioner.js`, `lib/popup/components/backdrop.js`, `lib/overview/defense.js`, `stylesheet.css`)
- `static-workspace-background@custom/` — Owned by M2 (`extension.js`)
- `tests/` — Owned by M3 / Final Milestone
