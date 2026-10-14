'use strict';

import Meta from 'gi://Meta';

import { isInRect, isOverlapRect } from './utils.js';

const DEBOUNCE_HIDE_TIMEOUT = 120;
const REVEAL_DELAY = 100;

// some codes lifted from dash-to-dock intellihide
const handledWindowTypes = [
  Meta.WindowType.NORMAL,
  // Meta.WindowType.DOCK,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
  // Meta.WindowType.TOOLBAR,
  // Meta.WindowType.MENU,
  Meta.WindowType.UTILITY,
  // Meta.WindowType.SPLASHSCREEN
];

export let AutoHide = class {
  enable() {
    if (this._enabled) return;
    // console.log('enable autohide');
    this._enabled = true;
    this._shown = true;
    this._dwell = 0;
    console.log('autohide enabled');
  }

  disable() {
    if (!this._enabled) return;
    if (this.extension._hiTimer) {
      this.extension._hiTimer.cancel(this._animationSeq);
    }
    this.extension._loTimer?.cancel(this._debounceCheckSeq);
    this._debounceCheckSeq = null;

    this._cancelReveal();
    this.show();

    this._enabled = false;

    for (const window of this._trackedWindows || []) this._untrack(window);

    console.log('autohide disabled');
  }

  _getScaleFactor() {
    //! use dock scale factor
    let scaleFactor = this.dock._monitor.geometry_scale;
    return scaleFactor;
  }

  _cancelReveal() {
    this.extension._hiTimer?.cancel(this._revealSeq);
    this._revealSeq = null;
  }

  _isAtRevealEdge(pointer) {
    const monitor = this.dock._monitor;
    const dwell = this.dock.dwell;
    if (!monitor || !dwell || monitor.inFullscreen) return false;
    const [x, y] = pointer;
    if (x < monitor.x || x >= monitor.x + monitor.width ||
        y < monitor.y || y >= monitor.y + monitor.height) return false;
    const [edgeX, edgeY] = dwell.get_transformed_position();
    if (!isInRect([edgeX, edgeY, dwell.width, dwell.height], pointer)) return false;
    // The reactive strip is two pixels thick, but only the outermost pixel
    // should summon the dock. The inner pixel remains safe to hover.
    switch (this.dock._position) {
      case 'left': return x < monitor.x + 1;
      case 'right': return x >= monitor.x + monitor.width - 1;
      case 'top': return y < monitor.y + 1;
      case 'bottom': return y >= monitor.y + monitor.height - 1;
      default: return false;
    }
  }

  _onMotionEvent() {
    if (!this._enabled || this._shown) return;
    const pointer = global.get_pointer();
    if (!this._isAtRevealEdge(pointer)) {
      this._cancelReveal();
      return;
    }
    if (this._revealSeq || !this.extension._hiTimer) return;
    this._revealSeq = this.extension._hiTimer.runOnce(() => {
      this._revealSeq = null;
      if (this._enabled && !this._shown && this._isAtRevealEdge(global.get_pointer()))
        this.show();
    }, REVEAL_DELAY, 'dockReveal');
  }

  _onEnterEvent() {
    this._onMotionEvent();
  }

  _onLeaveEvent() {
    this._cancelReveal();
    if (this._shown) {
      this._dwell = 0;
      this._debounceCheckHide();
    }
  }

  _onFocusWindow() {
    this._debounceCheckHide();
  }

  _onFullScreen() {
    this._debounceCheckHide();
  }

  show() {
    this._cancelReveal();
    if (!this.dock._monitor || this.dock._monitor.inFullscreen) {
      return;
    }
    this._dwell = 0;
    this.frameDelay = 0;
    this._shown = true;
    this.dock.slideIn();
  }

  hide() {
    this._cancelReveal();
    this._dwell = 0;
    this.frameDelay = 10;
    this._shown = false;
    this.dock.slideOut();
  }

  _track(window) {
    //! window tracking should be made global
    this._trackedWindows ??= new Set();
    if (!this._trackedWindows.has(window)) {
      window.connectObject(
        'position-changed',
        // this._debounceCheckHide.bind(this),
        () => {
          this.dock.extension.checkHide();
        },
        'size-changed',
        // this._debounceCheckHide.bind(this),
        () => {
          this.dock.extension.checkHide();
        },
        'unmanaged',
        () => this._untrack(window),
        this
      );
      this._trackedWindows.add(window);
    }
  }

  _untrack(window) {
    try {
      if (window && this._trackedWindows?.has(window)) {
        window.disconnectObject(this);
      }
    } catch (err) {
      // may have been destroyed already
    }
    this._trackedWindows?.delete(window);
  }

  _checkOverlap() {
    // console.log("checking overlap...");
    if (this.extension._inOverview) {
      return false;
    }
    let pointer = global.get_pointer();
    if (this.extension.simulated_pointer) {
      pointer = [...this.extension.simulated_pointer];
    }

    // console.log(pointer);

    let pos = this.dock.struts.get_transformed_position();
    let rect = {
      x: pos[0],
      y: pos[1],
      w: this.dock.struts.width,
      h: this.dock.struts.height,
    };
    //! change to struts rect
    let arect = [rect.x, rect.y, rect.w, rect.h];

    // console.log(arect);

    if (!this.extension.autohide_dash) {
      return false;
    }

    // console.log("checking pointer location...");

    if (this._shown !== false &&
        (this.dock._isWithinDash(pointer) || isInRect(arect, pointer))) {
      return false;
    }

    if (!this.extension.autohide_dodge) {
      return true;
    }

    // console.log("checking fullscreen...");

    if (this.dock._monitor && this.dock._monitor.inFullscreen) {
      return true;
    }

    // console.log("checking windows...");

    let monitor = this.dock._monitor;
    if (!monitor) return false;
    let actors = global.get_window_actors();
    let windows = actors.map((a) => {
      let w = a.get_meta_window();
      w._parent = a;
      return w;
    });
    windows = windows.filter((w) => w.can_close());
    windows = windows.filter((w) => w.get_monitor() == monitor.index);
    // windows = windows.filter((w) => !w.is_override_redirect());
    let workspace = global.workspace_manager.get_active_workspace_index();
    windows = windows.filter(
      (w) =>
        workspace == w.get_workspace()?.index() && w.showing_on_its_workspace()
    );
    windows = windows.filter((w) => handledWindowTypes.includes(w.get_window_type()));

    let isOverlapped = false;
    let dockRect = this.dock.struts.get_transformed_position();
    dockRect.push(this.dock.struts.width);
    dockRect.push(this.dock.struts.height);

    windows.forEach((w) => {
      this._track(w);
      if (isOverlapped) return;

      let frame = w.get_frame_rect();
      let win = [frame.x, frame.y, frame.width, frame.height];

      if (isOverlapRect(dockRect, win)) {
        isOverlapped = true;
      }
    });

    this.windows = windows;

    // console.log(isOverlapped);
    return isOverlapped;
  }

  _debounceCheckHide() {
    if (this.extension._loTimer) {
      if (!this._debounceCheckSeq) {
        this._debounceCheckSeq = this.extension._loTimer.runDebounced(
          () => {
            this._checkHide();
          },
          DEBOUNCE_HIDE_TIMEOUT,
          'debounceCheckHide'
        );
      } else {
        this.extension._loTimer.runDebounced(this._debounceCheckSeq);
      }
    }
  }

  _checkHide() {
    if (this._enabled) {
      if (this._checkOverlap()) {
        this.hide();
      } else {
        this.show();
      }
    }
  }
};
