import Clutter from 'gi://Clutter';

const WINDOW_PICKER = 1;

// Shell fades minimized previews itself, but allocates them between the
// workarea's top-left corner and their overview slot. Keep those previews at
// their destination while that fade runs. Call after the native allocation so
// its slot calculation, clipping, normal windows and overlays remain intact.
export function alignMinimizedWindowPreviews(layout, allocationBox) {
  const {currentState} = layout._overviewAdjustment.getStateTransitionParams();
  if (currentState > WINDOW_PICKER || layout._stateAdjustment.value >= 1)
    return;

  const slotsWidth = layout._windowSlotsBox?.get_width() ?? 0;
  if (slotsWidth <= 0)
    return;
  const scale = allocationBox.get_width() / slotsWidth;
  if (!Number.isFinite(scale) || scale <= 0)
    return;

  for (const [x, y, width, height, preview] of layout._windowSlots) {
    const info = layout._windows.get(preview);
    if (!preview.visible || !info?.metaWindow.minimized)
      continue;

    const box = new Clutter.ActorBox({
      x1: x * scale,
      y1: y * scale,
      x2: (x + width) * scale,
      y2: (y + height) * scale,
    });
    if (preview.allocation.equal(box))
      continue;

    // A layout reshuffle may still own an allocation transition when the
    // user exits Overview. Stop it before placing the fading preview, so it
    // cannot pull the preview back toward a previous allocation next frame.
    if (info.currentTransition)
      preview.remove_transition('allocation');
    preview.save_easing_state();
    try {
      preview.set_easing_duration(0);
      preview.allocate(box);
    } finally {
      preview.restore_easing_state();
    }
  }
}
