const assert = require("node:assert/strict");
const { test } = require("node:test");

async function withChrome(run, initialState = "normal") {
  const api = await import("../extension/fullscreen.js");
  const previousChrome = global.chrome;
  const store = {};
  const window = { id: 2, type: "normal", state: initialState };
  const changes = [];
  global.chrome = {
    storage: {
      session: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (items) => Object.assign(store, items),
        remove: async (key) => { delete store[key]; }
      }
    },
    tabs: { get: async (id) => ({ id, active: id === 3, windowId: 2 }) },
    windows: {
      get: async () => ({ ...window }),
      update: async (id, { state }) => {
        assert.equal(id, window.id);
        changes.push(state);
        window.state = state;
      }
    }
  };
  try {
    await run({ api, changes, window, store });
  } finally {
    global.chrome = previousChrome;
  }
}

const enter = { tabId: 3, status: "active", fullscreen: true };
const exit = { ...enter, fullscreen: false };

test("a captured tab uses browser fullscreen and restores the previous window state", () =>
  withChrome(async ({ api, changes, store }) => {
    await api.reflectCaptureFullscreen(enter);
    await api.reflectCaptureFullscreen(enter);
    await api.reflectCaptureFullscreen({ ...exit, tabId: 9 });
    assert.deepEqual(changes, ["fullscreen"]);
    assert.equal(store.managedVideoFullscreen.previousState, "maximized");
    await api.reflectCaptureFullscreen(exit);
    assert.deepEqual(changes, ["fullscreen", "maximized"]);
    assert.equal(store.managedVideoFullscreen, undefined);
  }, "maximized"));

test("browser fullscreen started by the user is preserved", () =>
  withChrome(async ({ api, changes, store, window }) => {
    await api.reflectCaptureFullscreen(enter);
    await api.reflectCaptureFullscreen(exit);
    assert.deepEqual(changes, []);
    assert.equal(store.managedVideoFullscreen, undefined);
    assert.equal(window.state, "fullscreen");
  }, "fullscreen"));

test("switching tabs or stopping capture restores only Sound Booster's own window", () =>
  withChrome(async ({ api, changes }) => {
    await api.reflectCaptureFullscreen(enter);
    await api.restoreWhenTabLeaves(8, 4);
    assert.deepEqual(changes, ["fullscreen"]);
    await api.restoreWhenTabLeaves(8, 2);
    assert.deepEqual(changes, ["fullscreen", "normal"]);
    await api.reflectCaptureFullscreen(enter);
    await api.reflectCaptureFullscreen({ ...enter, status: "stopped" });
    assert.deepEqual(changes, ["fullscreen", "normal", "fullscreen", "normal"]);
  }));

test("a manual window exit clears the saved ownership", () =>
  withChrome(async ({ api, changes, window }) => {
    await api.reflectCaptureFullscreen(enter);
    window.state = "normal";
    await api.forgetClosedOrExitedWindow(2);
    window.state = "fullscreen";
    await api.reflectCaptureFullscreen(exit);
    assert.deepEqual(changes, ["fullscreen"]);
    assert.equal(window.state, "fullscreen");
  }));
