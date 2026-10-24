import {readFile} from 'node:fs/promises';
import {resolve, dirname, isAbsolute} from 'node:path';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';

// Run the real extension modules with explicit GI/Shell boundaries. Missing
// imports fail instead of silently replacing untested dependencies.
export async function loadModule(path, {mocks = {}, globals = {}} = {}) {
    const context = createContext({console, TextDecoder, TextEncoder, ...globals});
    const cache = new Map();
    async function getModule(id) {
        if (cache.has(id))
            return cache.get(id);
        const loading = (async () => {
            if (Object.hasOwn(mocks, id)) {
                const exports = mocks[id];
                return new SyntheticModule(Object.keys(exports), function () {
                    for (const [key, value] of Object.entries(exports))
                        this.setExport(key, value);
                }, {context, identifier: id});
            }
            if (!isAbsolute(id))
                throw new Error(`Missing test dependency: ${id}`);
            return new SourceTextModule(await readFile(id, 'utf8'), {
                context,
                identifier: id,
                importModuleDynamically: async (specifier, module) => {
                    const imported = await getModule(resolveId(specifier, module));
                    if (imported.status === 'unlinked')
                        await imported.link(linker);
                    if (imported.status === 'linked')
                        await imported.evaluate();
                    return imported;
                },
            });
        })();
        cache.set(id, loading);
        return loading;
    }
    const resolveId = (specifier, module) => Object.hasOwn(mocks, specifier)
        ? specifier : specifier.startsWith('.')
            ? resolve(dirname(module.identifier), specifier) : specifier;
    const linker = (specifier, module) => getModule(resolveId(specifier, module));
    const module = await getModule(resolve(path));
    await module.link(linker);
    await module.evaluate();
    return module.namespace;
}

export class Actor {
    constructor(params = {}) {
        this.children = [];
        this.signals = new Map();
        this.transitions = new Map();
        this.classes = new Set();
        this.x = this.y = this.translationX = this.translationY = 0;
        this.scaleX = this.scaleY = 1;
        this.opacity = 255;
        this.visible = true;
        this.width = this.height = 48;
        Object.assign(this, params);
    }
    connect(name, callback) {
        const id = Symbol(name);
        this.signals.set(id, {name, callback});
        return id;
    }
    disconnect(id) {
        if (!this.signals.delete(id))
            throw new Error('Disconnecting unknown signal');
    }
    emit(name, ...args) {
        for (const {name: signal, callback} of [...this.signals.values()]) {
            if (signal === name)
                callback(this, ...args);
        }
    }
    add_child(actor) {
        if (actor.parent)
            throw new Error('Actor already has a parent');
        this.children.push(actor);
        actor.parent = this;
        this.emit('child-added', actor);
    }
    insert_child_above(actor) { this.add_child(actor); }
    insert_child_below(actor) { this.add_child(actor); }
    insert_child_at_index(actor) { this.add_child(actor); }
    set_child_above_sibling(actor, sibling = null) {
        if (actor.parent !== this)
            return;
        const index = this.children.indexOf(actor);
        if (index !== -1)
            this.children.splice(index, 1);
        if (!sibling) {
            this.children.push(actor);
        } else {
            const sibIndex = this.children.indexOf(sibling);
            if (sibIndex === -1)
                this.children.push(actor);
            else
                this.children.splice(sibIndex + 1, 0, actor);
        }
    }
    set_child_below_sibling(actor, sibling = null) {
        if (actor.parent !== this)
            return;
        const index = this.children.indexOf(actor);
        if (index !== -1)
            this.children.splice(index, 1);
        if (!sibling) {
            this.children.unshift(actor);
        } else {
            const sibIndex = this.children.indexOf(sibling);
            if (sibIndex === -1)
                this.children.unshift(actor);
            else
                this.children.splice(sibIndex, 0, actor);
        }
    }
    remove_child(actor) {
        if (actor.parent !== this)
            throw new Error('Removing actor from wrong parent');
        this.children.splice(this.children.indexOf(actor), 1);
        actor.parent = null;
    }
    remove_all_children() {
        for (const child of [...this.children])
            this.remove_child(child);
    }
    get_children() { return [...this.children]; }
    get_parent() { return this.parent ?? null; }
    get_stage() { return this.destroyed ? null : {}; }
    get_style() { return this.style ?? null; }
    get_effect() { return null; }
    set_style(style) { this.style = style; }
    add_style_class_name(name) { this.classes.add(name); }
    remove_style_class_name(name) { this.classes.delete(name); }
    has_style_class_name(name) { return this.classes.has(name); }
    set_style_class_name(name) { this.style_class = name; }
    get position() {
        return {x: this.x, y: this.y};
    }
    set position(val) {
        if (typeof val === 'string' || typeof val === 'number')
            throw new TypeError(`Wrong type ${typeof val}; boxed type GraphenePoint expected`);
        if (val && typeof val.x === 'number' && typeof val.y === 'number') {
            this.x = val.x;
            this.y = val.y;
        }
    }
    get pivot_point() {
        return {x: this._pivotX ?? 0.5, y: this._pivotY ?? 0.5};
    }
    set pivot_point(val) {
        if (typeof val === 'string' || typeof val === 'number')
            throw new TypeError(`Wrong type ${typeof val}; boxed type GraphenePoint expected`);
        if (val && typeof val.x === 'number' && typeof val.y === 'number') {
            this._pivotX = val.x;
            this._pivotY = val.y;
        }
    }
    set_pivot_point(x, y) {
        if (Number.isNaN(x) || Number.isNaN(y))
            throw new Error(`clutter_actor_set_pivot_point: assertion '!isnan (x) && !isnan (y)' failed`);
        this._pivotX = x;
        this._pivotY = y;
    }
    get_pivot_point() {
        return [this._pivotX ?? 0.5, this._pivotY ?? 0.5];
    }
    set_size(width, height) {
        if (Number.isNaN(width) || Number.isNaN(height))
            throw new Error(`clutter_actor_set_size: assertion '!isnan (width) && !isnan (height)' failed`);
        Object.assign(this, {width, height});
    }
    set_icon_size(size) { this.icon_size = size; }
    set_scale(x, y) { this.scaleX = x; this.scaleY = y; }
    set_position(x, y) {
        if (Number.isNaN(x) || Number.isNaN(y))
            throw new Error(`clutter_actor_set_position: assertion '!isnan (x) && !isnan (y)' failed`);
        Object.assign(this, {x, y});
    }
    get_transformed_position() {
        const parent = this.parent?.get_transformed_position() ?? [0, 0];
        return [parent[0] + this.x + this.translationX,
            parent[1] + this.y + this.translationY];
    }
    get_transformed_size() { return [this.width * this.scaleX, this.height * this.scaleY]; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    ease(params) {
        this.remove_transition('ease');
        this.transitions.set('ease', params);
    }
    ease_property(property, value, params) {
        this.remove_transition(property);
        this.transitions.set(property, {...params, [property]: value});
        return 'native-result';
    }
    complete(property = 'ease') {
        const params = this.transitions.get(property);
        if (!params)
            throw new Error(`No transition ${property}`);
        this.transitions.delete(property);
        for (const [key, value] of Object.entries(params)) {
            if (!['duration', 'mode', 'onStopped', 'onComplete'].includes(key))
                this[key] = value;
        }
        params.onStopped?.(true);
        params.onComplete?.();
    }
    remove_transition(property) {
        const params = this.transitions.get(property);
        this.transitions.delete(property);
        params?.onStopped?.(false);
    }
    remove_all_transitions() {
        for (const property of this.transitions.keys())
            this.remove_transition(property);
    }
    destroy() {
        this.emit('destroy');
        this.remove_all_transitions();
        for (const child of [...this.children])
            child.destroy();
        this.parent?.remove_child(this);
        this.destroyed = true;
    }
}

// Model GJS's most-derived _init dispatch without requiring production classes
// to carry JavaScript-constructor shims solely for Node mocks.
export class GObjectActor extends Actor {
    _init(params = {}) { Object.assign(this, params); }
}
export function registerGObjectClass(...args) {
    const Original = args.at(-1);
    return class extends Original {
        constructor(...params) {
            super(...params);
            if (!this._gobjectInitialized) {
                this._gobjectInitialized = true;
                this._init?.(...params);
            }
        }
    };
}
