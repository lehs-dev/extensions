import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setupPaintSignals() {
    class Effect {
        vfunc_paint() { this.paintCount = (this.paintCount ?? 0) + 1; }
    }
    class EffectActor extends Actor {
        constructor() { super(); this.effects = new Set(); }
        add_effect(effect) { this.effects.add(effect); }
        remove_effect(effect) { assert.equal(this.effects.delete(effect), true); }
    }
    const {PaintSignals} = await loadModule('blur-my-shell@aunetx/conveniences/paint_signals.js', {
        mocks: {
            'gi://GObject': {default: {registerClass: (_metadata, cls) => cls}},
            'gi://Clutter': {default: {Effect}},
        },
    });
    const connections = {
        connect: (actor, signal, callback) => actor.connect(signal, callback),
        disconnect: (actor, id) => actor.disconnect(id),
    };
    return {paintSignals: new PaintSignals(connections), actor: new EffectActor()};
}

for (const cleanup of ['disconnect', 'destroy']) {
    test(`an in-flight blur paint finishes after ${cleanup} without invoking a cleared callback`, async () => {
        const {paintSignals, actor} = await setupPaintSignals();
        let repaints = 0;
        paintSignals.connect(actor, {queue_repaint() { repaints++; }});
        const effect = [...actor.effects][0];
        for (let i = 0; i < 4; i++)
            effect.vfunc_paint({}, {}, 0);
        assert.equal(repaints, 2, 'normal paints retain repaint throttling');

        if (cleanup === 'destroy')
            actor.destroy();
        else
            paintSignals.disconnect_all_for_actor(actor);

        assert.equal(paintSignals.entries.size, 0);
        assert.doesNotThrow(() => effect.vfunc_paint({}, {}, 0));
        assert.equal(repaints, 2, 'the released repaint target is no longer called');
        assert.equal(effect.paintCount, 5, 'the native paint chain still completes');
        assert.doesNotThrow(() => paintSignals.disconnect_all());
    });
}
