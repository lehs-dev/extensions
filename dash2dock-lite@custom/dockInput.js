import St from 'gi://St';

// Input follows the painted icons, with a small margin bounded by the dock.
// The invisible native Dash keeps its layout; native actions still own app
// activation, menus, keyboard focus and drag-and-drop.
export function createIconHitTarget(dock, renderer) {
  const target = new St.Button({name: 'DockIconHitTarget', reactive: true,
    can_focus: true, track_hover: true,
    button_mask: (St.ButtonMask?.PRIMARY ?? 1) | (St.ButtonMask?.MIDDLE ?? 2) | (St.ButtonMask?.SECONDARY ?? 4),
    style: 'background: transparent; border: 0; box-shadow: none; padding: 0; margin: 0; min-width: 0; min-height: 0;'});
  target.visible = false;
  target.connect('clicked', (_target, button) => {
    const item = target._sourceItem;
    if (item && target.visible && !dock._dragging) dock._activateIcon(item, button || 1);
  });
  target.connect('motion-event', () => dock._onMotionEvent());
  target.connect('enter-event', () => dock._onEnterEvent());
  target.connect('leave-event', () => dock._onLeaveEvent());
  target.connect('scroll-event', (_target, event) => dock._onScrollEvent(target, event));
  target.connect('destroy', () => releaseSource(target));
  dock.renderArea.add_child(target);
  renderer._hitTarget = target;
  return target;
}

function releaseSource(target, sourceDestroyed = false) {
  const binding = target._dragBinding;
  target._dragBinding = null;
  if (binding) {
    binding.source.disconnect(binding.destroySignal);
    if (binding.gesture?.get_actor?.() === target) {
      target.remove_action(binding.gesture);
      if (!sourceDestroyed) binding.origin.add_action(binding.gesture);
    }
  }
  target._sourceItem = target._delegate = null;
}

function bindSource(target, item) {
  if (target._sourceItem === item) return;
  releaseSource(target);
  target._sourceItem = item;
  const source = item._appwell ?? item.child ?? item;
  target._delegate = source._delegate ?? source;
  target.accessible_name = source.accessible_name || item._label?.text || 'Application';
  // GNOME 51's DND gesture reads the pointer from the actor it is attached to,
  // while the Draggable continues to use the original AppIcon as its delegate.
  const gesture = source._draggable?._dndGesture;
  const origin = gesture?.get_actor?.();
  const destroySignal = source.connect('destroy', () => {
    releaseSource(target, true);
    target.hide();
  });
  target._dragBinding = {source, destroySignal, gesture, origin};
  if (origin && origin !== target) {
    origin.remove_action(gesture);
    target.add_action(gesture);
  }
}

export function syncIconHitTargets(dock) {
  if (dock._dragging) return;
  const paint = dock._background?._paintedRect;
  const [offsetX, offsetY] = dock.renderArea.get_transformed_position();
  const pad = Math.min(4, Math.max(2, (dock._iconSizeScaledDown ?? 32) * 0.1));
  for (const item of dock._icons ?? []) {
    const renderer = item._renderer;
    const target = renderer?._hitTarget;
    if (!target) continue;
    bindSource(target, item);
    const bounds = item._renderBounds;
    if (!paint || !bounds || renderer.visible === false || dock._hidden || dock.visible === false) {
      item._hitBounds = null;
      target.hide();
      continue;
    }
    const left = Math.max(bounds.x - pad, dock.x + paint.x);
    const top = Math.max(bounds.y - pad, dock.y + paint.y);
    const right = Math.min(bounds.x + bounds.width + pad, dock.x + paint.x + paint.width);
    const bottom = Math.min(bounds.y + bounds.height + pad, dock.y + paint.y + paint.height);
    const x = left - offsetX, y = top - offsetY;
    const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
    item._hitBounds = {x: left, y: top, width, height};
    if (target.x !== x || target.y !== y) target.set_position(x, y);
    if (target.width !== width || target.height !== height) target.set_size(width, height);
    target.visible = width > 0 && height > 0;
  }
}
