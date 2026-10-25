'use strict';

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';

const ST_SIDE_RIGHT = St.Side.RIGHT;
const ST_SIDE_LEFT = St.Side.LEFT;
// Shell 51 takes an options object; earlier Shells take PopupAnimation flags.
const animationOptions = (menu, animate) => typeof menu._getPopupAnimationFromParams === 'function'
  ? {animate} : animate ? PopupAnimation.FULL : PopupAnimation.NONE;

/** A temporary anchor for Shell-owned menus. Native actors and modal grabs stay owned by Shell. */
export class SystemMenus {
  constructor(params = {}) {
    this.systemDock = params.systemDock;
    this.state = params.state;
    this._activeAdapter = null;
  }

  get available() {
    return !!(Main.panel?.statusArea?.quickSettings?.menu &&
      Main.panel?.statusArea?.dateMenu?.menu);
  }

  get isAnyMenuOpen() {
    const menu = this._activeAdapter?.menu;
    return !!menu && (menu.isOpen || !!menu._boxPointer?.visible);
  }

  _openNativeMenu(menu, sourceButton, options = {}) {
    if (!menu || !sourceButton) return false;
    if (this._activeAdapter?.menu === menu && menu.isOpen) {
      this.closeAll();
      return true;
    }
    this.closeAll();
    // A menu may already be open from the native panel. Close it before changing its anchor.
    if (menu.isOpen) menu.close(animationOptions(menu, false));

    const pointer = menu._boxPointer;
    const monitor = Main.layoutManager.findMonitorForActor?.(sourceButton) ||
      Main.layoutManager.primaryMonitor;
    const workArea = Main.layoutManager.getWorkAreaForMonitor?.(
      monitor?.index ?? Main.layoutManager.primaryIndex) || monitor;
    const original = {
      source: menu.sourceActor,
      focus: menu.focusActor,
      alignment: menu._arrowAlignment,
      pointerSource: pointer?._sourceActor,
      pointerAlignment: pointer?._arrowAlignment,
      sourceAlignment: pointer?._sourceAlignment,
      side: pointer?._userArrowSide ?? pointer?._arrowSide,
      style: menu.actor?.style ?? null,
    };
    const side = options.side ?? sourceButton.side ??
      (this.systemDock?.dockPosition === 'left' || this.systemDock?.edge === 'left' || this.systemDock?.position === 'left' ? ST_SIDE_LEFT : ST_SIDE_RIGHT);
    const owner = sourceButton._systemPod || this.systemDock;
    let menuSignal = null;
    let menuClosedSignal = null;
    let sourceSignal = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (menuSignal !== null) menu.disconnect(menuSignal);
      if (menuClosedSignal !== null) menu.disconnect(menuClosedSignal);
      if (sourceSignal !== null) sourceButton.disconnect(sourceSignal);
      menu.sourceActor = original.source;
      menu.focusActor = original.focus;
      menu._arrowAlignment = original.alignment;
      if (pointer) {
        if (pointer.updateArrowSide) pointer.updateArrowSide(original.side);
        else pointer._arrowSide = original.side;
        if (pointer.setPosition)
          pointer.setPosition(original.pointerSource ?? original.source,
            original.pointerAlignment ?? original.alignment ?? 0.5);
        else pointer._sourceActor = original.pointerSource;
        if (original.sourceAlignment !== undefined)
          pointer.setSourceAlignment?.(original.sourceAlignment);
      }
      if (menu.actor) menu.actor.style = original.style;
      if (this._activeAdapter?.menu === menu) this._activeAdapter = null;
      owner?.onMenuStateChanged?.(false);
    };
    this._activeAdapter = {menu, cleanup, owner, sourceButton};

    try {
      menuClosedSignal = menu.connect('menu-closed', cleanup);
      menuSignal = menu.connect('open-state-changed', (_menu, open) => {
        // Shell emits this before its fade-out ends. Re-anchoring a still visible
        // BoxPointer would move the fading popup back to the hidden panel.
        if (!open && !pointer?.visible) cleanup();
      });
      sourceSignal = sourceButton.connect('destroy', () => this.closeAll());
      menu.sourceActor = sourceButton;
      menu.focusActor = options.focusActor ?? sourceButton;
      menu._arrowAlignment = 0.5;
      if (pointer) {
        // Both fields matter: BoxPointer recalculates flips from _userArrowSide on allocation.
        if (pointer.updateArrowSide) pointer.updateArrowSide(side);
        else pointer._arrowSide = pointer._userArrowSide = side;
        pointer.setPosition?.(sourceButton, 0.5);
        pointer.setSourceAlignment?.(0.5);
      }
      if (menu.actor && workArea) {
        // St applies CSS in logical coordinates. BoxPointer itself clamps the allocation
        // to the active monitor; overriding _reposition would break Shell 51's ActorBox API.
        const style = original.style || '';
        menu.actor.style = `${style}${style && !style.endsWith(';') ? ';' : ''} max-height: ${Math.max(1, workArea.height - 24)}px; max-width: ${Math.max(1, workArea.width - 24)}px;`;
      }
      owner?.onMenuStateChanged?.(true);
      menu.open(animationOptions(menu, true));
      if (!menu.isOpen) {
        cleanup();
        return false;
      }
      return true;
    } catch (error) {
      console.error('dash2dock-lite: native menu could not open', error);
      try { menu.close(animationOptions(menu, false)); } finally { cleanup(); }
      return false;
    }
  }

  toggleDateMenu(source, options = {}) {
    return this._openNativeMenu(Main.panel?.statusArea?.dateMenu?.menu, source, options);
  }

  toggleQuickSettings(source, _section = null, options = {}) {
    return this._openNativeMenu(Main.panel?.statusArea?.quickSettings?.menu, source, options);
  }

  toggleKeyboardMenu(source, options = {}) {
    const area = Main.panel?.statusArea;
    // Fcitx's active indicator owns its menu and properties. Do not redirect to IBus.
    const indicator = this.state?.inputSource?.provider === 'kimpanel'
      ? area?.kimpanel : area?.keyboard;
    return this._openNativeMenu(indicator?.menu, source, options);
  }

  togglePowerMenu(source, options = {}) {
    return this.toggleQuickSettings(source, 'power', options);
  }

  updateAnchor(owner) {
    const adapter = this._activeAdapter;
    if (adapter?.owner === owner)
      adapter.menu._boxPointer?.setPosition?.(adapter.sourceButton, 0.5);
  }

  closeAll() {
    const adapter = this._activeAdapter;
    if (!adapter) return;
    try { adapter.menu.close(animationOptions(adapter.menu, false)); }
    finally { adapter.cleanup(); }
  }

  destroy() {
    this.closeAll();
    this.systemDock = null;
    this.state = null;
  }
}
