# Desktop 3 — four attached modules

Current working-tree update, 25 October 2026. This section supersedes the earlier implementation notes below. The source is the local checkout, including its existing uncommitted changes. No commit, push, extension reload, or host setting change was performed.

Left Modular now has Quick Settings at the upper-left corner, an independent Input Method Pod 3 logical pixels below it (reduced from 6 px), the existing Application Dock centered in the remaining left-edge region, and Clock at the lower-left corner. The input pod follows `modular-show-input-source` and is hidden when neither native keyboard nor Kimpanel provides an available menu. Each module retains its own Attached Edge contour and input region. All four resting bodies share a fixed 34 logical pixel width; compact pod contents are centered within that width.

- Application Dock counts icon spacing once inside each vertical source slot. Native layout spacing is normalized for Left Modular, and the native horizontal separator becomes a one-pixel horizontal line in the vertical list. Its size/style and layout spacing restore on return to Dual Edge. The capsule grows in height by one source slot per added application, with fixed end flares/padding. Its resting width, native viewport and source slot width stay at 34 px, including when unpinned applications open or close. Base icons are capped at 30 px to fit the body, without changing saved Dual Edge sizes or the magnification factor. The background no longer derives its width from transient native icon bounds. The existing magnification, two-frame hover envelope, centered placement and overflow scrolling remain in use.
- Quick Settings uses one shaped, focusable button. Status icons and revealed labels are passive presenters; clicking anywhere on its painted capsule opens the original GNOME Quick Settings menu. Kimpanel is presented exclusively in Input Method Pod, using `SystemState` and the active provider's original menu through `SystemMenus`. No Fcitx/IBus backend or Kimpanel code was changed.
- Quick Settings, Input Method and Clock reveal information to the right using the existing 210 ms entry / 240 ms exit timeline. Hover is driven by the actual shaped button's native `notify::hover` property, rather than crossing events on the passive root. Information appears before any click; click opens the original menu. Focus returning after popup dismissal does not latch the capsule open. Canvas geometry, content translations, clipping, opacity and the menu anchor follow the same progress. Actor allocations stay fixed during hover; the reveal never calls desktop layout or dock layout. Only the current painted silhouette is reactive. The native menu keeps its owning capsule expanded until dismissal finishes.
- Information comes from the existing providers: Wi-Fi name, Bluetooth state, volume, battery percentage, Kimpanel property labels/current mode, and full weekday/date. Clock reserves enough room for its information even when compact weekday/date labels are disabled. Provider changes reuse labels; removal and layout transitions release listeners and interrupted timelines.
- GNOME Shell 51 fixes include binding the pod timeline to its actor's frame clock, using native menu animation options objects on Shell 51, and reading the native reduced-motion property. Older popup animation flags remain supported. The existing Just Perfection panel ownership, fullscreen behavior and Dual Edge integration are retained.

Validation on installed **GNOME Shell 51.1**:

- **372/372 Node regression tests** across 33 test files passed. Coverage includes pin/unpin sizing, opening/closing an unpinned app with native 48 px texture replacement and transient bounds while retaining the 34 px body, constant flare/padding, overflow/focus scrolling, stable dock hover, native surface hover before clicking, three independent information reveals with zero allocation writes during animation, menu dismissal without focus latching, Kimpanel property-only changes, repeated layout switches, Just Perfection and related extension regressions.
- Native GJS/Gio migration/persistence tests and GObject/geometry checks passed. This host's `/tmp` mount rejects Gio trash operations used by the existing clipboard migration test; rerunning with `TMPDIR="$PWD"` passes without changing that unrelated code.
- `npm run check`: **223 JavaScript files, 8 schema directories, zero failures**. `git diff --check` passed.
- GJS introspection against the installed St/Clutter 51 libraries confirmed button signals, shaped picking, clipping, orientation and the actor-bound Timeline property. The installed Shell 51.1 Dash, network, Bluetooth, PopupMenu and BoxPointer source resources were inspected for the integration contracts.

Host visual/input acceptance remains pending: pin/unpin before and after overflow; move repeatedly between and outside all four capsules; click compact/revealed areas; open and dismiss Quick Settings, input and calendar menus; switch Kimpanel modes including an unchanged compact glyph; switch Dual Edge/Left Modular with menus open; repeat with Just Perfection panel ownership. The current session was not restarted or reloaded.

API references: [St ScrollView](https://gnome.pages.gitlab.gnome.org/gnome-shell/st/class.ScrollView.html), [Clutter Timeline](https://gnome.pages.gitlab.gnome.org/mutter/clutter/class.Timeline.html).

## Earlier implementation notes — three attached capsules

Updated 25 October 2026 for the existing local working tree. This correction starts from the modified and untracked Desktop 3 implementation already in `/workspaces/extensions`; it does not substitute remote content. Nothing was committed, pushed, or installed on the host.

The requested composition is an upper-left Quick Settings capsule, the retained Application Dock centered in the remaining left-edge region, and a lower-left Clock capsule. There is wallpaper between them and no right System Dock in Left Modular. Dual Edge remains separate.

## Final hover stability correction

The Desktop 3 application background now interpolates between two frames calculated for the current content and settings. Entry expands once (210 ms); exit contracts once (240 ms), with cubic easing and interruption from the current progress. Moving between icons changes their existing magnification and spreading without changing the expanded frame. Overflow retains fixed vertical bounds, and reduced motion applies the frame immediately. System-pod elevation preferences remain independent.

Desktop 3 animation frames reuse the completed dock layout. Native content additions/removals, app changes, mounts, fullscreen, monitor changes and geometry settings invalidate it. Ordinary pointer motion and child crossings reuse the active animation loop. The layout manager also skips Application Dock layout when the pod boundaries are unchanged. Native separator cleanup is guarded against invalidating its own icon discovery. Content signals use Clutter's documented [child-added and child-removed signals](https://gnome.pages.gitlab.gnome.org/mutter/clutter/class.Actor.html).

The application background uses the existing Attached Edge silhouette pick boxes, so painted gaps can sustain hover while transparent corners and unused allocation remain click-through. Removing all icons also removes the background input region. Existing icon activation, native menus, drag gestures, indicators and Magic Lamp integration remain in place.

Quick Settings and Clock keep their physical left-corner anchors and the shared flare/corner geometry. With measured content, old wide body preferences no longer create empty shelves: the compact base is at most 24 logical pixels, widened as needed for actual indicators or localized text. The dock remains centered between their spacing boundaries, and impossible layouts retain the existing fallback.

Validation: **363/363 Node tests**, native GJS/Gio checks, `npm run check` (223 JavaScript files, 8 schema directories), and `git diff --check`. Regressions cover moving hover at 60/120 Hz with zero frame/canvas geometry writes after expansion, layout and loop reuse, interrupted entry/exit, reduced motion, shaped input, empty input cleanup, native rediscovery, overflow and fullscreen. No settings were added, and nothing was committed, pushed or installed. The supplied screencast was not accessible in this session; this container has no GNOME Shell runtime, so live GNOME Shell 51 rendering/input and host logs remain unverified.

## Latest correction: painted click targets, steady hover and live indicators

The October 25 follow-up fixes the issues in the annotated desktop screenshots:

- The hidden native panel is untracked with `untrackChrome()`, releasing its work-area strut while retaining the native menu hierarchy. Original chrome flags and visibility are restored when the replacement is disabled; Just Perfection ownership and fullscreen remain respected. GNOME 51 calculates struts from `affectsStruts` even for hidden actors: see [the GNOME 51 layout implementation](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/layout.js#L969).
- Pods now meet the physical top-left and bottom-left screen corners. The corner-facing end is square, with its flare and rounding removed; the end facing the Application Dock retains its foot. Frame thickness and corner radius add no inset. The default upper/lower offsets are zero.
- Content starts 2 logical pixels from the left edge and keeps its natural width, including when an older wider body preference is saved. Both default body widths are 24 logical pixels (minimum 20); natural content measurement can widen them for localized labels. Indicator size remains 16 pixels and spacing remains 3 pixels.
- Clock labels use the same 11 px size, weight and color. Default hover elevation is reduced from 8 to 3 logical pixels.
- The Application Dock background follows interpolated icon bounds, restoring growth and contraction in both directions. Geometry is calculated before any actor changes, committed once, aligned to pixels and left untouched after settling. The previous per-frame intermediate sizes could force repeated allocations while reading renderer transforms. The canvas also resizes only when required.
- `dockInput.js` supplies real `St.Button` input targets above the source Dash/scroll wrapper, aligned to the painted icons with a 2–4 px margin confined to dock paint. Rendered icons and invisible source wrappers no longer intercept clicks. Primary/middle clicks, native app menus, Show Apps and custom items use their existing actions. The original GNOME 51 DND gesture follows the painted input target and returns to its source on cleanup; the original AppIcon remains the drag delegate. See [GNOME 51 DND](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/dnd.js).
- Animation translations are stored in JavaScript rather than applied to invisible native icon/container actors. Renderer bounds are cached from the same frame used to draw them. Native BaseIcon sizes match the configured slots; texture replacements preserve the application menu/label and refresh the texture reference, following [GNOME 51 BaseIcon's replacement behavior](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/iconGrid.js). Hover no longer changes the work-area reservation beside maximized windows.
- Hover entry uses the measured resting icon footprint. Active hover also bridges painted space between magnified icons; profile changes cannot shrink the body out from under the pointer. There is no extra hover tolerance beyond the painted crown toward an adjacent application. Long overflowing lists retain fixed vertical bounds and navigation headroom.
- Quick Settings observes the native indicator tree, including indicators added/removed after enable. Visible indicators beyond the five represented controls get compact buttons, and the pod grows/shrinks with them. Separate native screen-recording and screen-sharing actions are mirrored once each and retain their stop actions. Privacy, microphone, camera, VPN and extension indicators inside native Quick Settings follow their actual local visibility even while the original panel is hidden. Same-size changes reuse the button; removed providers disconnect. See [GNOME 51 panel indicators](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/panel.js) and [recording/sharing actions](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/status/remoteAccess.js).

Verification for this follow-up: **355/355 Node tests passed**, native GJS/Gio checks passed, `npm run check` passed (223 JavaScript files and 8 schema directories), and `git diff --check` passed. New regressions exercise activation beyond the original icon slot, middle/right clicks, zero extra hover at an application edge, hover across painted gaps, unchanged source/work-area geometry, native texture replacement, drag-gesture restoration and dynamic recording/sharing/extra indicators. Existing corner, overflow, lifecycle and 60/120 Hz regressions remain. The compiled schema cache is included. Live GNOME Shell rendering and input dispatch have not been tested in the Dev Container.

After copying the updated extension to the host using the deployment instructions below, apply the compact defaults if old values were explicitly saved. Run this from the updated repository on the GNOME host:

```bash
desktop_schema_dir="$PWD/dash2dock-lite@custom/schemas"
for key in modular-upper-pod-offset modular-lower-pod-offset \
           modular-quicksettings-width modular-clock-width \
           modular-indicator-icon-size modular-indicator-spacing \
           modular-elevation-distance; do
  gsettings --schemadir "$desktop_schema_dir" reset org.gnome.shell.extensions.dash2dock-lite "$key"
done
gsettings --schemadir "$desktop_schema_dir" set org.gnome.shell.extensions.dash2dock-lite desktop-layout 1
gsettings --schemadir "$desktop_schema_dir" set org.gnome.shell.extensions.dash2dock-lite system-dock-hide-topbar true
```

Log out and back in to load the changed JavaScript and CSS. Check maximized windows against the upper screen edge, both pod menus, dock hover/leave, overflow scrolling, and restoring the native bar when disabling the extension. These host steps have not been executed from the container.

For the latest screenshots, click the outer part of the enlarged VS Code icon, test middle/right click and dragging a favorite, then move vertically along the enlarged dock's crown. At rest, placing the cursor just outside the painted dock at the application edge must not magnify or activate anything. Start/stop GNOME recording and a screen-sharing session: the compact status actions must appear/disappear and the upper pod must resize.

## Previous capsule correction

The incoming code already created separate pod actors and reused `AttachedDockCanvas`, but it had **no whole-capsule hover animation**. It also used default pod flares instead of saved Application Dock geometry, could measure a previous fixed allocation as the content's natural size, and relaid out the Application Dock on ordinary clock/audio changes.

This correction adds:

- `systemDock/podElevation.js`: one normalized progress value per system pod, driven by a Clutter Timeline only during transitions. Defaults are 8 logical pixels rightward, 210 ms entering, 240 ms returning, with cubic ease-out. Reversals start from the current progress; timelines disconnect on completion, interruption, and destruction. Reduced motion or disabled system animations applies the state immediately.
- `attachedGeometry.js`: the Application Dock's existing geometry function moved into a shared pure module and re-exported from `attachedBackground.js`, preserving its original import contract. With the default zero offset, Application Dock drawing is unchanged. The added offset moves the left capsule's crown, corners, and body right together, lengthens the connector, and leaves its two screen-edge attachment tips and edge tangents stationary.
- `attachedBackground.js`: the same fill and contour paths render elevated pods. Body offset and elevation progress invalidate the drawing cache; the existing ambient shadow strengthens slightly. A reserved drawing extent is excluded from the silhouette's geometry.
- `systemDock/modularPods.js`: the background and every content element follow the same progress. Only the content container translates; the renderer stretches the connection to the stationary edge. No button, icon, or text line scales or animates independently. Pointer crossings between children retain the group state, keyboard focus raises its owning pod, and hiding a pod resets interaction and closes its adapted menu.
- Shaped picking: each pod has a nonreactive root and drawing surface, plus a dedicated input surface whose Clutter pick boxes lie inside the current Bézier silhouette. Its curved ends use conservative one-logical-pixel bands; the straight body uses one rectangle. Unpainted animation reserve, transparent corners, shadows, and wallpaper between pods do not take input. There is no global pointer-motion subscription, recurring hover timer, or full-height reactive rail.
- `systemDock/systemMenus.js`: the temporary native menu adapter retains the owning pod through popup dismissal, tracks its moving content anchor, and restores the original native source/focus/arrow/style state afterward. Dismissal re-picks the pointer once because native menu grabs can suppress crossing events. Popup animation arguments use GNOME's `PopupAnimation` constants. Native panel widgets remain owned by GNOME.
- `desktopLayoutManager.js` and `systemDockLayout.js`: pods inherit saved `flare-width`, `foot-depth`, and `attached-corner-radius` from the Application Dock. Content widths and frame/foot padding are included when choosing an effective pod width; saved width preferences are not rewritten. The existing centralized vertical placement/collision calculation remains. Natural content measurement bypasses fixed allocation requests. Unchanged clock/audio values update existing labels/icons without repainting the pod background or relaying out the dock; hardware visibility and measured content size changes still update layout.
- Quick Settings order follows the request: network, Bluetooth, volume, battery, input source. All providers remain real, shared GNOME/Kimpanel state; absent hardware is hidden.
- `integrations.js`: Left Modular suppresses Blur My Shell's existing rectangular dock overlay, which otherwise fills the organic flare's transparent area. The saved blur preference is preserved and restored by Dual Edge's existing integration path. Native popup blur remains owned by Blur My Shell. No shader or separate pod blur layer was added.
- Minimal settings: `modular-group-elevation` (default true), `modular-elevation-distance` (0–16, default 8 logical pixels), and `modular-animation-duration` (0–600, default 210 ms). They appear alongside existing Left Modular controls. Application Dock magnification preferences remain independent.

The Application Dock actor, icon magnification/spreading, app actions, pinned/running icons, drag and drop, autohide, overflow support, and Magic Lamp target integration were retained. Screen Frame, the optional gap provider, and the existing Tiling Assistant contract were retained. This correction does not add changes to other extensions; the pre-existing Tiling Assistant edits in the incoming tree still need to accompany deployment.

## Integration map and ownership

This is an audit of the actual local implementations and GNOME Shell 51 source, **not evidence of which extensions are enabled in the host session**.

| Feature | Owner and shared signals/state | Relevant modification/conflict and treatment |
| --- | --- | --- |
| Panel visibility, chrome and work areas | GNOME `Main.layoutManager`; Just Perfection `lib/API.js` and `lib/Manager.js` | Just Perfection can reparent/retrack/translate `panelBox`, hide indicators, and alter Overview layout. The existing Desktop Layout Manager watches its panel setting, changes only its own visual visibility snapshot, and leaves panel parents, translations and struts with their existing owners. |
| System indicators | GNOME native `_network`, Bluetooth `BtClient`, volume output/stream, and system battery toggle/proxy | One `SystemState` shares icon/client/property signals with both pods or the Dual Edge rail. No competing network, Bluetooth, mixer or power clients are created. Existing provider replacement and cleanup tests remain. |
| Time and date | GNOME Date Menu WallClock plus interface clock-format preference | Clock/timezone and format signals update reused upright labels. The existing minute-boundary fallback is used only when the native clock provider is unavailable. Changes that preserve natural size do not reposition the Application Dock. |
| Input methods | GNOME input-source manager or visible Kimpanel indicator | `kimpanel@custom/indicator.js` owns label/icon state and its native property menu; `extension.js` owns Fcitx integration and panel registration. `SystemState` observes current source, label/icon and visibility signals, including extension state changes; the adapter opens the active provider's existing menu. No input daemon or menu is replaced. |
| Native Quick Settings / Calendar / notifications / input menus | GNOME PopupMenu, BoxPointer and popup menu manager; Kimpanel for its own menu | One `SystemMenus` adapts source/focus/arrow position reversibly. Left-facing arrows place popups to the right. Native monitor clamping, modal grabs and keyboard handling remain native. Pod motion updates the existing BoxPointer anchor. |
| Pod backgrounds and outline | Existing Application Dock Cairo renderer and effective dock colors | Shared color, alpha, border, corner and flare settings. Two additional content-sized actors use the renderer; they are not Application Dock instances. Only these two actors use group elevation. |
| Blur and popup visual effects | `blur-my-shell@custom/components/{dash_to_dock,panel}.js` and `components/popup/*` | Dock discovery targets `dashtodockContainer` / `DashToDock`, so pods do not masquerade as docks. The rectangular dock overlay is suppressed in Left Modular; native popup target classes/actors remain intact for the existing popup effects. Panel blur is not reparented. |
| Screen frame and outer gaps | Existing `screenFrame.js`, `windowGaps.js`; Tiling Assistant geometry utilities | The frame stays nonreactive and adds no struts. Tiling Assistant reads the existing optional `getScreenGaps()` provider. Already-consumed work-area insets are subtracted once; saved Tiling Assistant gap settings are not changed. No floating-window manipulation or new tiling engine is added. |
| Minimize / restore animations | `compiz-alike-magic-lamp-effect@custom` plus existing `integrations.js` app-icon resolver | System-pod elevation never changes Application Dock icon coordinates. Existing app-specific, monitor-aware/overflow-aware targets and reversible Magic Lamp hook remain. |
| Fullscreen, monitor transitions, Overview and stacking | GNOME chrome and the existing layout/frame managers | Pods add chrome without struts and track fullscreen. Their local interaction resets when hidden. Existing layout transitions close menus, release previous actors, share one provider owner and retain the original app dock. Real compositor stacking and transitions require host acceptance. |

The source audit also checked `dock.js`, `dockItems.js`, `animator.js`, `dockOverflow.js`, `screenFrame.js`, `windowGaps.js`, `systemDock.js`, system state/items/menus, and the other extensions listed above. No permanent native widget reparenting or alternate window-management ownership was introduced.

## Automated verification

The incoming baseline passed **315 Node tests**. Final results for this correction:

| Check | Result |
| --- | --- |
| `npm test` | **330/330 Node tests passed**, including the native Desktop 3 Gio.Settings regression; native clipboard GJS/Gio checks passed. |
| `npm run check` | Passed JavaScript syntax and all 8 schema directory/cache checks. |
| `glib-compile-schemas --strict dash2dock-lite@custom/schemas` | Passed; compiled cache updated. |
| `git diff --check` | Passed. |
| Native GJS module parsing and preferences XML inspection | Passed for this correction's runtime/settings files; preference object IDs are unique. |
| Live GNOME Shell rendering / pointer routing / hardware / Gtk preferences | **Not run in this Dev Container.** |

Focused regressions cover body/corner movement, stationary attachment points, the actual Cairo path at elevation, drawing-cache invalidation, shaped Clutter pick submission, unchanged icon scales, stable actor allocation, interrupted hover, movement between child buttons, keyboard focus, native menu retention through dismissal, one-time pointer re-picking after grabs, reduced motion, fullscreen reset, natural size measurement, ordinary state-update cost, repeated mode changes with actual pod actors, shared listener cleanup, and the mode-specific blur contract. Existing strict adjacent-window hover, Application Dock magnification, Magic Lamp, screen gaps and other-extension tests remain. A new app-animation regression verifies that system elevation settings do not alter the Application Dock's per-icon results.

Node Shell boundaries are explicit mocks. The Cairo test records drawing commands; it does not render the host desktop. Native Gio tests verify settings, not compositor behavior.

## Safe host deployment

These instructions have **not** been executed. Run them on the real GNOME host, using a host-accessible copy of the **complete current working tree, including untracked files**. An older remote checkout lacks the new modules. Keep the terminal available throughout acceptance.

Inspect the session and active extension paths first:

```bash
gnome-shell --version
printf '%s\n' "$XDG_SESSION_TYPE"
gnome-extensions info dash2dock-lite@custom
gnome-extensions info tiling-assistant@custom
```

Use the user-local paths below only after confirming they are the paths the host loads. Reconcile a different custom install path before copying. Set `desktop_repo` to the updated host checkout, not a container-only path.

```bash
(
set -eu
desktop_repo="/absolute/host/path/to/extensions"
desktop_install="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
desktop_backup="$HOME/desktop3-backup-$(date +%Y%m%d-%H%M%S)"

test -f "$desktop_repo/dash2dock-lite@custom/attachedGeometry.js"
test -f "$desktop_repo/dash2dock-lite@custom/dockInput.js"
test -f "$desktop_repo/dash2dock-lite@custom/systemDock/podElevation.js"
test -f "$desktop_repo/tiling-assistant@custom/src/extension/utility.js"
mkdir -p "$desktop_backup" "$desktop_install"
gnome-extensions list --enabled > "$desktop_backup/enabled-extensions.txt"
dconf dump /org/gnome/shell/extensions/dash2dock-lite/ > "$desktop_backup/dock-settings.dconf"
dconf dump /org/gnome/shell/extensions/tiling-assistant/ > "$desktop_backup/tiling-settings.dconf"

for desktop_uuid in dash2dock-lite@custom tiling-assistant@custom; do
    if test -e "$desktop_install/$desktop_uuid"; then
        cp -aL -- "$desktop_install/$desktop_uuid" "$desktop_backup/$desktop_uuid"
    fi
done

gnome-extensions disable dash2dock-lite@custom
gnome-extensions disable tiling-assistant@custom

for desktop_uuid in dash2dock-lite@custom tiling-assistant@custom; do
    mkdir -p "$desktop_install/$desktop_uuid"
    if test "$(realpath "$desktop_repo/$desktop_uuid")" != "$(realpath "$desktop_install/$desktop_uuid")"; then
        rsync -a --exclude='*.bak' --exclude='gschemas.compiled' \
            "$desktop_repo/$desktop_uuid/" "$desktop_install/$desktop_uuid/"
    fi
    glib-compile-schemas --strict "$desktop_install/$desktop_uuid/schemas"
done
printf 'Backup: %s\n' "$desktop_backup"
)
```

Both directories are included because the incoming Desktop 3 gap integration already changes Tiling Assistant. Existing install symlinks are retained; synchronization is skipped when source and destination resolve to the same directory. The commands do not reset appearance settings or write unrelated extension directories.

**Log out and back in on Wayland after deploying JavaScript.** Disable/enable alone does not reliably reload cached ES modules. Then re-enable the intended extensions, preserving the previous enabled list recorded in the backup. For a session that previously used both:

```bash
gnome-extensions enable tiling-assistant@custom
gnome-extensions enable dash2dock-lite@custom
gnome-extensions info dash2dock-lite@custom
gnome-extensions prefs dash2dock-lite@custom
```

Select **Left Modular**, show both system pods, and start with the top bar visible until both native menus work. New group defaults are elevation enabled, distance 8, duration 210. Existing appearance and frame preferences are preserved; no reset is needed. Test first with current saved geometry, then tune existing flare/frame/width controls if desired.

To return to Dual Edge from a host terminal:

```bash
desktop_schema_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/dash2dock-lite@custom/schemas"
gsettings --schemadir "$desktop_schema_dir" set org.gnome.shell.extensions.dash2dock-lite desktop-layout 0
```

If the panel or controls are inaccessible, first run `gnome-extensions disable dash2dock-lite@custom`. Check Just Perfection's panel setting if it also hides the panel. To roll back source, disable the affected pair, restore their backed-up directories at the confirmed installation paths, compile the restored schemas, log out/in, and restore the prior enabled list. The dconf dumps are available if explicitly restoring settings is wanted; normal source rollback does not require resetting them.

## Manual visual acceptance on GNOME Shell 51 / Wayland

1. **Composition and theme:** upper Quick Settings, retained app dock centered between pods, lower upright clock; wallpaper gaps, no right system rail, no full-height input rail. Compare all three backgrounds, border alpha/thickness, rounded crown, smooth flares, edge attachment and frame continuity. Check the current saved geometry and larger icon sizes for clipping.
2. **Central interaction:** hover background, spacing, icons and every clock line. The complete system body/content moves gently right, stays attached, and returns smoothly. No system icon/text zoom. Move quickly between buttons, between pods, across transparent flare corners and into an adjacent app window; empty space must pass clicks through. App icons must still magnify/spread as before.
3. **Native menus:** open each system indicator and Calendar/Notifications to the right. Move from pod to popup, use keyboard navigation/Escape, click outside, dismiss back over the pod, and switch layouts with a menu open. Only the owning pod stays raised, and all native panel menus still work afterward.
4. **Real providers:** change network, Bluetooth, output volume/device, charging state and input source. Test Fcitx/Kimpanel and GNOME input sources as configured; absent hardware must disappear. Check locale, weekday/date, 12/24-hour preference, timezone/time changes, and updates across midnight without actor rebuilding or background churn.
5. **Lifecycle and accessibility:** toggle both pods and elevation; tune distance/duration; change modes repeatedly; disable/re-enable after loading the new source. Test keyboard focus, reduced motion and system animations disabled. Verify no orphan actors, lost native controls, repeated journal errors or continuing idle animation.
6. **Interoperability:** repeat with Just Perfection hiding/showing the panel, Blur My Shell panel/popup effects enabled, Tiling Assistant tile/resize/maximize, and Magic Lamp minimize/restore. Check no rectangular blur behind flares; switching back to Dual Edge restores its saved blur behavior. Gaps, floating windows and saved settings must remain consistent with the existing integration.
7. **Compositor checks:** fullscreen video/apps, Overview, lock/unlock, negative monitor origins, primary-monitor changes, monitor reconnect, HiDPI/fractional scaling, and 60/120 Hz where available. Confirm popup stacking, pointer grabs, frame alignment, magnification clipping, drag and drop, app context menus and autohide/intellihide.

All seven groups still require real host confirmation. In particular, mock picking tests do not establish real Wayland event routing, native popup grabs/placement, blur composition, physical display scaling or visual smoothness. Capture resting/raised screenshots and a popup from each pod, plus app magnification, when accepting the implementation.

Useful host diagnostics:

```bash
journalctl --user -b --since '10 minutes ago' -o short-precise \
    | rg 'dash2dock|DesktopScreenFrame|SystemDock|QuickSettingsPod|ClockPod|tiling-assistant|JS ERROR|Gjs'
```

## API sources checked

- [GNOME Shell 51 BoxPointer](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/boxpointer.js), [PopupMenu](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/popupMenu.js), and [layout/chrome](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/layout.js): native popup ownership, positioning, animation constants, dismissal and chrome contracts.
- [Mutter 51 actor implementation](https://raw.githubusercontent.com/GNOME/mutter/51.0/clutter/clutter/clutter-actor.c) and [Timeline](https://raw.githubusercontent.com/GNOME/mutter/51.0/clutter/clutter/clutter-timeline.c): shaped `pick_box()` regions and actor-associated frame-clock animation.
- [GNOME Shell 51 St settings](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/src/st/st-settings.c), [Bluetooth](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/status/bluetooth.js), and [volume](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/status/volume.js): reduced motion and the existing native state/signal providers.
