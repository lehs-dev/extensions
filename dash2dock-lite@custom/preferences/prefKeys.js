import GLib from 'gi://GLib';

export let PrefKeys = class {
  constructor(patch) {
    this._keys = {};

    if (patch) {
      Object.keys(patch).forEach((k) => {
        this[k] = patch[k];
      });
    }
  }

  setKeys(keys) {
    Object.keys(keys).forEach((name) => {
      let key = keys[name];
      this.setKey(
        name,
        key.default_value,
        key.widget_type,
        key.key_maps,
        key.test,
        key.callback,
        key.options,
        key.themed,
        key.value_type
      );
    });
  }

  setKey(
    name,
    default_value,
    widget_type,
    maps,
    test,
    callback,
    options,
    themed,
    value_type
  ) {
    this._keys[name] = {
      name,
      default_value,
      widget_type,
      value: default_value,
      maps: maps,
      test: test,
      callback,
      options,
      object: null,
      themed: themed || false,
      value_type,
    };
  }

  _numericType(name, key) {
    // The installed schema is authoritative. Metadata also supports callers
    // preparing values before a settings object has been connected.
    const settings = this._settings;
    if (settings?.settings_schema?.has_key(name)) {
      return settings.settings_schema.get_key(name).get_value_type().dup_string();
    }
    if (settings?.get_value) {
      return settings.get_value(name).get_type_string();
    }
    if (key.value_type === 'int') return 'i';
    if (key.value_type === 'double') return 'd';
    return key.value_type || 'd';
  }

  _isIntegerKey(name, key) {
    return ['i', 'u', 'n', 'q'].includes(this._numericType(name, key));
  }

  _readScale(name, key) {
    const type = this._numericType(name, key);
    if (type === 'i') return this._settings.get_int(name);
    if (type === 'u') return this._settings.get_uint(name);
    if (type === 'n' || type === 'q') return this._settings.get_value(name).deepUnpack();
    return this._settings.get_double(name);
  }

  setValue(name, value) {
    const key = this._keys[name];
    const settings = this._settings;
    if (key.widget_type === 'scale') {
      if (!Number.isFinite(value))
        throw new TypeError(`${name}: expected a finite number`);
      if (this._isIntegerKey(name, key)) value = Math.round(value);
    }
    key.value = value;
    if (settings) {
      switch (key.widget_type) {
        case 'switch':
          settings.set_boolean(name, value);
          break;
        case 'dropdown':
          settings.set_int(name, value);
          break;
        case 'scale': {
          const type = this._numericType(name, key);
          if (type === 'i') settings.set_int(name, value);
          else if (type === 'u') settings.set_uint(name, value);
          else if (type === 'n' || type === 'q')
            settings.set_value(name, new GLib.Variant(type, value));
          else settings.set_double(name, value);
          break;
        }
        case 'color':
          settings.set_value(name, new GLib.Variant('(dddd)', value));
          break;
      }
    }
    key.callback?.(key.value);
  }

  _syncWidget(key) {
    if (!key.object) return;
    const wasUpdating = this._updatingWidgets;
    this._updatingWidgets = true;
    try {
      switch (key.widget_type) {
        case 'switch': key.object.set_active(key.value); break;
        case 'dropdown': key.object.set_selected(key.value); break;
        case 'scale': key.object.set_value(key.value); break;
        case 'color':
          key.object.set_rgba(this._toRGBA({
            red: key.value[0], green: key.value[1],
            blue: key.value[2], alpha: key.value[3],
          }));
          break;
      }
    } finally {
      this._updatingWidgets = wasUpdating;
    }
  }

  getKey(name) {
    return this._keys[name];
  }

  getValue(name) {
    let value = this._keys[name].value;
    return value;
  }

  reset(name) {
    this.setValue(name, this._keys[name].default_value);
  }

  resetAll() {
    Object.keys(this._keys).forEach((k) => {
      this.reset(k);
    });
  }

  keys() {
    return this._keys;
  }

  _toRGBA() {
    console.log('implement me!');
    // implement @ patch
    return null;
  }

  connectSettings(settings, callback) {
    this.disconnectSettings();
    this._settingsListeners = [];

    this._settings = settings;
    let builder = this._builder;
    let self = this;
    let keys = this._keys;

    this._updatingWidgets = true;
    try {
      Object.keys(keys).forEach((name) => {
        let key = keys[name];
        key.object = builder ? builder.get_object(key.name) : null;
        switch (key.widget_type) {
          case 'json_array': {
            key.value = [];
            try {
              key.value = JSON.parse(settings.get_string(name));
            } catch (err) {
              // fail silently
            }
            break;
          }
          case 'switch': {
            key.value = settings.get_boolean(name);
            if (key.object) key.object.set_active(key.value);
            break;
          }
          case 'dropdown': {
            key.value = settings.get_int(name);
            try {
              if (key.object) key.object.set_selected(key.value);
            } catch (err) {
              //
            }
            break;
          }
          case 'scale': {
            key.value = this._readScale(name, key);
            if (name === 'icon-size') {
              if (key.value === 0) {
                key.value = 48;
              } else if (key.value > 0 && key.value < 12) {
                key.value = Math.round(12 + key.value * 84);
              }
            }
            if (key.object) key.object.set_value(key.value);
            break;
          }
          case 'string': {
            key.value = settings.get_string(name);
            if (key.object) key.object.set_value(key.value);
            break;
          }
          case 'color': {
            key.value = settings.get_value(name).deepUnpack();
            try {
              if (key.object) {
                key.object.set_rgba(
                  // new Gdk.RGBA({
                  this._toRGBA({
                    red: key.value[0],
                    green: key.value[1],
                    blue: key.value[2],
                    alpha: key.value[3],
                  })
                );
              }
            } catch (err) {
              //
            }
            break;
          }
        }

        this._settingsListeners.push(
          settings.connect(`changed::${name}`, () => {
            let key = keys[name];
            switch (key.widget_type) {
              case 'json_array': {
                key.value = [];
                try {
                  key.value = JSON.parse(settings.get_string(name));
                } catch (err) {
                  // fail silently
                }
                break;
              }
              case 'switch': {
                key.value = settings.get_boolean(name);
                break;
              }
              case 'dropdown': {
                key.value = settings.get_int(name);
                break;
              }
              case 'scale': {
                key.value = this._readScale(name, key);
                if (name === 'icon-size') {
                  if (key.value === 0) {
                    key.value = 48;
                  } else if (key.value > 0 && key.value < 12) {
                    key.value = Math.round(12 + key.value * 84);
                  }
                }
                break;
              }
              case 'color': {
                key.value = settings.get_value(name).deepUnpack();
                if (key.value.length != 4) {
                  key.value = [1, 1, 1, 0];
                }
                break;
              }
              case 'string': {
                key.value = settings.get_string(name);
                break;
              }
            }
            this._syncWidget(key);
            if (callback) callback(name, key.value);
          })
        );
      });
    } finally {
      this._updatingWidgets = false;
    }
  }

  disconnectSettings() {
    (this._settingsListeners || []).forEach((id) => {
      this._settings.disconnect(id);
    });
    this._settingsListeners = [];
    this._settings = null;
  }

  disconnectBuilder() {
    for (const { source, signal_id } of this._builderListeners || []) {
      if (signal_id !== null) source.disconnect(signal_id);
    }
    this._builderListeners = [];
    this._builder = null;
  }

  connectBuilder(builder) {
    this.disconnectBuilder();
    this._builderListeners = [];

    this._builder = builder;
    let self = this;
    let keys = this._keys;
    Object.keys(keys).forEach((name) => {
      let key = keys[name];
      let signal_id = null;
      key.object = builder.get_object(key.name);
      if (!key.object) {
        return;
      }

      switch (key.widget_type) {
        case 'json_array': {
          // unimplemented
          break;
        }
        case 'switch': {
          key.object.set_active(key.default_value);
          signal_id = key.object.connect('notify::active', (w) => {
            if (self._updatingWidgets) return;
            self.setValue(name, w.get_active());
          });
          break;
        }
        case 'dropdown': {
          signal_id = key.object.connect('notify::selected-item', (w) => {
            if (self._updatingWidgets) return;
            let index = w.get_selected();
            if (index === 0xffffffff) return;
            let value = key.maps && index in key.maps ? key.maps[index] : index;
            self.setValue(name, value);
          });
          break;
        }
        case 'scale': {
          signal_id = key.object.connect('value-changed', (w) => {
            if (self._updatingWidgets) return;
            let value = w.get_value();
            self.setValue(name, value);
          });
          break;
        }
        case 'color': {
          signal_id = key.object.connect('color-set', (w) => {
            if (self._updatingWidgets) return;
            let rgba = w.get_rgba();
            let value = [rgba.red, rgba.green, rgba.blue, rgba.alpha];
            self.setValue(name, value);
          });
          break;
        }
        case 'button': {
          signal_id = key.object.connect('clicked', (w) => {
            if (key.callback) {
              key.callback();
            }
          });
          break;
        }
      }

      this._builderListeners.push({
        source: key.object,
        signal_id: signal_id,
      });
    });
  }
};
