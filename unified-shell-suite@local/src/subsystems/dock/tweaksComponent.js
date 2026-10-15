/**
 * Unified Shell Suite - TweaksComponent
 * Declarative, non-destructive UI customizations derived from Just-Perfection.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class TweaksComponent {
    constructor(settings) {
        this._settings = settings;
        this._savedPanelVisibility = null;
        this._savedActivitiesVisibility = null;
    }

    enable() {
        this.update();
    }

    update() {
        // 1. Panel Visibility
        const panelVisible = this._settings.get_boolean('tweak-panel-visible');
        if (this._savedPanelVisibility === null) {
            this._savedPanelVisibility = Main.panel.visible;
        }
        Main.panel.visible = panelVisible;

        // 2. Activities Button
        const showActivities = this._settings.get_boolean('tweak-show-activities');
        const activitiesButton = Main.panel.statusArea.activities;
        if (activitiesButton) {
            if (this._savedActivitiesVisibility === null) {
                this._savedActivitiesVisibility = activitiesButton.container.visible;
            }
            activitiesButton.container.visible = showActivities;
        }
    }

    disable() {
        if (this._savedPanelVisibility !== null) {
            Main.panel.visible = this._savedPanelVisibility;
            this._savedPanelVisibility = null;
        }

        const activitiesButton = Main.panel.statusArea.activities;
        if (activitiesButton && this._savedActivitiesVisibility !== null) {
            activitiesButton.container.visible = this._savedActivitiesVisibility;
            this._savedActivitiesVisibility = null;
        }
    }
}

