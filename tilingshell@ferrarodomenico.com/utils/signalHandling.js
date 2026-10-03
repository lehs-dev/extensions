class SignalHandling {
  _signalsIds;
  constructor() {
    this._signalsIds = [];
  }

  connect(obj, key, fun) {
    const signalId = obj.connect(key, fun);
    this._signalsIds.push({ id: signalId, obj });
    return signalId;
  }

  disconnect(obj, signalId) {
    const matches = this._signalsIds.filter((signal) =>
      (!obj || signal.obj === obj) &&
      (signalId === undefined || signal.id === signalId)
    );
    // Forget handlers first so callbacks may safely disconnect during cleanup.
    this._signalsIds = this._signalsIds.filter((signal) => !matches.includes(signal));
    matches.forEach((signal) => signal.obj.disconnect(signal.id));
    return matches.length > 0;
  }
}

export {
  SignalHandling as default
};
