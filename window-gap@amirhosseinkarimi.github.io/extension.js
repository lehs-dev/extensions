// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Amir Hossein Karimi

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { GapManager } from './gapManager.js';

export default class WindowGapExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._gapManager = new GapManager(this._settings);

        this._settings.connectObject(
            'changed', () => this._gapManager.rebuild(),
            this
        );
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._gapManager.rebuild(),
            this
        );

        this._gapManager.rebuild();
    }

    disable() {
        this._settings?.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);

        this._gapManager?.destroy();
        this._gapManager = null;
        this._settings = null;
    }
}
