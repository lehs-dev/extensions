# Static Workspace Background

Keeps the wallpaper stationary during workspace switches and Overview. In the
window picker, native window previews move over a full-screen wallpaper instead
of a scaled desktop card. Minimized windows fade in at their Overview positions
instead of flying out from the top-left corner, and remain minimized when
Overview closes unless selected.

At rest, only the selected workspace's windows are visible. Neighboring
workspaces remain available during swipes and window dragging. Opening the app
grid fades the primary workspace's windows in place, without shrinking them
toward the workspace strip; reversing the transition restores the same layout.

The first Super press shows the native workspace thumbnail strip above the
window previews. Thumbnails are 15% smaller than the original layout (136 px
high at 100% scale), with an 8 px top inset below the panel. The translucent
backdrop starts at half the primary monitor's work-area width and stays
centered. It grows equally on both sides as workspaces are added, following
native add/remove animations while preserving the usual thumbnail size.
Once the backdrop reaches the work-area edges, thumbnails shrink to fit,
including theme spacing, so both ends and the selection outline stay on screen.
Both thumbnails and backdrop
slide down from below the panel with Overview progress, including reversible
touchpad gestures, and follow native search fades. The backdrop shares the app
grid's 24 px corner radius. The app grid has its own rounded panel, without workspace
previews inside it. Its background uses the same white tint as the tiling
preview, at 20% opacity instead of the tiling preview's 12%.

The panel adapts to the primary monitor's work area and reserves room for the
Dock. At 1920×1200 and 100% scale its maximum size is 1400×960. Window selection,
workspace gestures, dragging windows between workspaces, app folders and app-grid
pagination continue to use GNOME Shell's actors and transitions.

## Loading changes

Update this extension's installed directory with all files in this directory,
including `overview.js`, `overviewLayout.js`, `minimizedWindowPreviews.js` and
`stylesheet.css`. Log out and back in on Wayland so Shell loads the new
JavaScript and stylesheet. Keep the
extension enabled in Extension Manager.

Disabling the extension restores the native Overview layout and backgrounds.
It does not rewrite settings belonging to the Dock, Spotlight, Blur my Shell or
Just Perfection.

## Desktop verification

- Open and close Overview, including an empty workspace. The wallpaper should
  remain full-screen while window previews spread out.
- Minimize all windows, then open and close Overview. Previews should fade at
  their Overview positions and the windows should remain minimized on exit.
- Press Super once. The workspace strip should be above the window previews;
  click a workspace and drag a window onto another thumbnail.
- Start with a few workspaces: the backdrop should occupy half the available
  width. Add and remove workspaces; both edges should expand/shrink equally.
  With 9–12 workspaces, check that every thumbnail and the selection outline
  remain on screen after resizing the display or changing scale.
- Open and close Overview with Super and three-finger swipes. The strip should
  emerge below the panel, reverse smoothly when a gesture is cancelled, and
  remain clipped below the panel during its reveal.
- Enter the app grid directly and from the window picker. Only apps and page
  controls should be inside the translucent panel. Hover an icon, click to
  launch an app, then test an app folder, page controls, keyboard focus and
  moving an icon between pages. Repeat after reversing a touchpad transition.
- With populated workspaces on either side, check that neighboring windows do
  not peek in at rest. Open the app grid slowly with a gesture and reverse it:
  window previews should fade at their picker positions throughout.
- Drag a window to another workspace, reverse a workspace swipe, and add/remove
  a workspace. Check multiple monitors and display scale changes.
- Disable the extension while Overview is open, then enable it again. Check
  that backgrounds and native layout are restored and that no Shell errors are
  logged.

Geometry and lifecycle tests run without GNOME Shell. Visual appearance,
touchpad gestures and GPU frame pacing still need verification in a GNOME 51
Wayland session.
