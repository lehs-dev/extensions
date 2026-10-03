import GLib from 'gi://GLib';
const Signals = imports.signals;

/// An enum non-extensively describing the type of gsettings key.
export const Type = {
    B: 'Boolean',
    I: 'Integer',
    D: 'Double',
    S: 'String',
    C: 'Color',
    AS: 'StringArray',
    PIPELINES: 'Pipelines'
};

// Validate the whole value before exposing it to pipeline consumers. Returning
// from a forEach callback would otherwise leave the original malformed value
// in use even after resetting the setting.
function unpack_pipelines(value) {
    const is_record = object => object !== null && typeof object === 'object' && !Array.isArray(object);
    const pips = value.deep_unpack();
    if (!is_record(pips))
        throw new Error('pipelines is not an object');

    for (const pipeline_id of Object.keys(pips)) {
        const pipeline = pips[pipeline_id];
        if (!is_record(pipeline) || !('name' in pipeline) || !('effects' in pipeline))
            throw new Error('pipeline has no name or effects');
        const name = pipeline.name.deep_unpack();
        if (typeof name !== 'string')
            throw new Error('pipeline name is not a string');
        const packed_effects = pipeline.effects.deep_unpack();
        if (!Array.isArray(packed_effects))
            throw new Error('pipeline effects is not an array');

        const effects = [];
        for (const packed_effect of packed_effects) {
            const effect = packed_effect.deep_unpack();
            if (!is_record(effect) || !('type' in effect) || !('id' in effect))
                throw new Error('effect has no type or id');
            const type = effect.type.deep_unpack();
            const id = effect.id.deep_unpack();
            if (typeof type !== 'string' || typeof id !== 'string')
                throw new Error('effect type or id is not a string');
            const params = 'params' in effect ? effect.params.deep_unpack() : {};
            if (!is_record(params))
                throw new Error('effect params is not an object');
            for (const param_key of Object.keys(params))
                params[param_key] = params[param_key].deep_unpack();
            effects.push({ type, id, params });
        }
        pips[pipeline_id] = { name, effects };
    }
    return pips;
}

/// An object to get and manage the gsettings preferences.
///
/// Should be initialized with an array of keys, for example:
///
/// let settings = new Settings([
///     { type: Type.I, name: "panel-corner-radius" },
///     { type: Type.B, name: "debug" }
/// ]);
///
/// Each {type, name} object represents a gsettings key, which must be created
/// in the gschemas.xml file of the extension.
export const Settings = class Settings {
    constructor(keys, settings) {
        this.settings = settings;
        this.keys = keys;

        this.keys.forEach(bundle => {
            let component = this;
            let component_settings = settings;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                this[bundle_component] = {
                    settings: this.settings.get_child(bundle.component)
                };
                component = this[bundle_component];
                component_settings = settings.get_child(bundle.component);
            }


            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);

                switch (key.type) {
                    case Type.B:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_boolean(key.name);
                            },
                            set(v) {
                                component_settings.set_boolean(key.name, v);
                            }
                        });
                        break;

                    case Type.I:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_int(key.name);
                            },
                            set(v) {
                                component_settings.set_int(key.name, v);
                            }
                        });
                        break;

                    case Type.D:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_double(key.name);
                            },
                            set(v) {
                                component_settings.set_double(key.name, v);
                            }
                        });
                        break;

                    case Type.S:
                        Object.defineProperty(component, property_name, {
                            get() {
                                return component_settings.get_string(key.name);
                            },
                            set(v) {
                                component_settings.set_string(key.name, v);
                            }
                        });
                        break;

                    case Type.C:
                        Object.defineProperty(component, property_name, {
                            // returns the array [red, blue, green, alpha] with
                            // values between 0 and 1
                            get() {
                                let val = component_settings.get_value(key.name);
                                return val.deep_unpack();
                            },
                            // takes an array [red, blue, green, alpha] with
                            // values between 0 and 1
                            set(v) {
                                let val = new GLib.Variant("(dddd)", v);
                                component_settings.set_value(key.name, val);
                            }
                        });
                        break;

                    case Type.AS:
                        Object.defineProperty(component, property_name, {
                            get() {
                                let val = component_settings.get_value(key.name);
                                return val.deep_unpack();
                            },
                            set(v) {
                                let val = new GLib.Variant("as", v);
                                component_settings.set_value(key.name, val);
                            }
                        });
                        break;

                    case Type.PIPELINES:
                        Object.defineProperty(component, property_name, {
                            get() {
                                try {
                                    return unpack_pipelines(component_settings.get_value(key.name));
                                } catch (error) {
                                    this._warn(`impossible to get pipelines, ${error.message}, resetting`);
                                    component[property_name + '_reset']();
                                    // Read the default directly: do not recursively call this
                                    // getter or return a partially unpacked invalid value.
                                    try {
                                        return unpack_pipelines(component_settings.get_default_value(key.name));
                                    } catch (default_error) {
                                        this._warn(`impossible to get default pipelines, ${default_error.message}`);
                                        return {};
                                    }
                                }
                            },
                            set(pips) {
                                let pipelines = {};
                                Object.keys(pips).forEach(pipeline_id => {
                                    let pipeline = pips[pipeline_id];
                                    if (!(pipeline && typeof pipeline === 'object' && pipeline.constructor === Object)) {
                                        this._warn('impossible to set pipelines, pipeline is not an object');
                                        return;
                                    }

                                    if (!('name' in pipeline)) {
                                        this._warn('impossible to set pipelines, pipeline has no name');
                                        return;
                                    }
                                    if (typeof pipeline.name !== 'string') {
                                        this._warn('impossible to set pipelines, pipeline name is not a string');
                                        return;
                                    }

                                    if (!('effects' in pipeline)) {
                                        this._warn('impossible to set pipelines, pipeline has no effect');
                                        return;
                                    }
                                    if (!Array.isArray(pipeline.effects)) {
                                        this._warn('impossible to set pipelines, effects is not an array');
                                        return;
                                    }

                                    let gvariant_effects = [];
                                    pipeline.effects.forEach(effect => {
                                        if (!(effect instanceof Object)) {
                                            this._warn('impossible to set pipelines, effect is not an object');
                                            return;
                                        }

                                        if (!('type' in effect)) {
                                            this._warn('impossible to set pipelines, effect has not type');
                                            return;
                                        }
                                        if (typeof effect.type !== 'string') {
                                            this._warn('impossible to set pipelines, effect type is not a string');
                                            return;
                                        }

                                        if (!('id' in effect)) {
                                            this._warn('impossible to set pipelines, effect has not id');
                                            return;
                                        }
                                        if (typeof effect.id !== 'string') {
                                            this._warn('impossible to set pipelines, effect id is not a string');
                                            return;
                                        }

                                        let params = {};
                                        if ('params' in effect) {
                                            params = effect.params;
                                        }
                                        let gvariant_params = {};
                                        Object.keys(params).forEach(param_key => {
                                            let param = params[param_key];
                                            if (typeof param === 'boolean')
                                                gvariant_params[param_key] = GLib.Variant.new_boolean(param);
                                            else if (typeof param === 'number') {
                                                if (Number.isInteger(param))
                                                    gvariant_params[param_key] = GLib.Variant.new_int32(param);
                                                else
                                                    gvariant_params[param_key] = GLib.Variant.new_double(param);
                                            } else if (typeof param === 'string')
                                                gvariant_params[param_key] = GLib.Variant.new_string(param);
                                            else if (Array.isArray(param) && param.length == 4)
                                                gvariant_params[param_key] = new GLib.Variant("(dddd)", param);
                                            else
                                                this._warn('impossible to set pipeline, effect parameter type is unknown');
                                        });

                                        gvariant_effects.push(
                                            new GLib.Variant("a{sv}", {
                                                type: GLib.Variant.new_string(effect.type),
                                                id: GLib.Variant.new_string(effect.id),
                                                params: new GLib.Variant("a{sv}", gvariant_params)
                                            })
                                        );
                                    });

                                    pipelines[pipeline_id] = {
                                        name: GLib.Variant.new_string(pipeline.name),
                                        effects: new GLib.Variant("av", gvariant_effects)
                                    };
                                });
                                let val = new GLib.Variant("a{sa{sv}}", pipelines);
                                component_settings.set_value(key.name, val);
                            }
                        });
                        break;
                }


                component[property_name + '_reset'] = function () {
                    return component_settings.reset(key.name);
                };

                component[property_name + '_signal_ids'] = [];
                component[property_name + '_changed'] = function (cb) {
                    component[property_name + '_signal_ids'].push(
                        component_settings.connect('changed::' + key.name, cb)
                    );
                };

                component[property_name + '_disconnect'] = function () {
                    component[property_name + '_signal_ids'].forEach(
                        id => component_settings.disconnect(id)
                    );
                    component[property_name + '_signal_ids'] = [];
                };
            });
        });
    };

    /// Reset the preferences.
    reset() {
        this.keys.forEach(bundle => {
            let component = this;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                component = this[bundle_component];
            }

            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);
                component[property_name + '_reset']();
            });
        });

        this.emit('reset', true);
    }

    /// From the gschema name, returns the name of the associated property on
    /// the Settings object.
    get_property_name(name) {
        return name.replaceAll('-', '_').toUpperCase();
    }

    /// Remove all connections managed by the Settings object, i.e. created with
    /// `settings.PROPERTY_changed(callback)`.
    disconnect_all_settings() {
        this.keys.forEach(bundle => {
            let component = this;
            if (bundle.component !== "general") {
                let bundle_component = bundle.component.replaceAll('-', '_');
                component = this[bundle_component];
            }

            bundle.schemas.forEach(key => {
                let property_name = this.get_property_name(key.name);
                component[property_name + '_disconnect']();
            });
        });
    }

    _warn(str) {
        console.warn(`[Blur my Shell > settings]     ${str}`);
    }
};

Signals.addSignalMethods(Settings.prototype);
