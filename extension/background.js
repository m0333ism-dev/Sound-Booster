import { normalizeSettings } from "./settings.js";
import { forgetClosedOrExitedWindow, reflectCaptureFullscreen, restoreWhenTabLeaves } from "./fullscreen.js";

const offscreenPage = "offscreen.html";
const offscreenUrl = chrome.runtime.getURL(offscreenPage);
const popupUrl = chrome.runtime.getURL("popup.html");
let queue = Promise.resolve();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "windows-spatial" || port.sender?.url !== offscreenUrl) return;
  let native;
  try {
    native = chrome.runtime.connectNative("com.sound_booster.spatial");
  } catch (error) {
    port.postMessage({ type: "error", message: error.message });
    return;
  }
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    native.disconnect();
  });
  native.onMessage.addListener((message) => {
    if (connected) port.postMessage(message);
  });
  native.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || "The Windows audio companion closed.";
    if (connected) port.postMessage({ type: "error", message });
    connected = false;
  });
  port.onMessage.addListener((message) => {
    if (connected) native.postMessage(message);
  });
});

function serialize(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });
  return contexts.length > 0;
}

async function audio(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ target: "audio", type, ...data });
  if (!result?.ok) throw new Error(result?.error || "The audio processor is unavailable.");
  return result.state;
}

async function readSettings() {
  const { levels } = await chrome.storage.local.get("levels");
  return normalizeSettings(levels);
}

async function handle({ type, tabId, levels }) {
  if (type === "status") {
    const state = await hasOffscreen() ? await audio("status") : { tabId: null };
    return { ...state, settings: await readSettings() };
  }
  if (type === "settings") {
    const settings = normalizeSettings(levels);
    await chrome.storage.local.set({ levels: settings });
    if (await hasOffscreen()) await audio("settings", { settings });
    return { settings };
  }
  if (type === "start") {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) throw new Error("Open the extension on the tab you want to process.");
    const settings = await readSettings();
    const alreadyOpen = await hasOffscreen();
    if (alreadyOpen && (await audio("status")).tabId === tabId) return;

    // Chrome grants capture for the tab where the toolbar action was invoked.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!alreadyOpen) {
      await chrome.offscreen.createDocument({
        url: offscreenPage,
        reasons: ["USER_MEDIA"],
        justification: "Process captured tab audio and play it while the popup is closed."
      });
    }
    try {
      await audio("start", { tabId, streamId, settings, muted: Boolean(tab.mutedInfo?.muted) });
    } catch (error) {
      if (!alreadyOpen) await chrome.offscreen.closeDocument();
      throw error;
    }
    return;
  }
  if (type === "stop" && await hasOffscreen()) {
    await audio("stop", { tabId });
    if ((await audio("status")).tabId === null) await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "worker" || sender.url !== popupUrl) return false;
  serialize(() => handle(message)).then(
    (state) => respond({ ok: true, state }),
    (error) => {
      console.warn("Sound Booster:", error.message);
      respond({ ok: false, error: error.message });
    }
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, { mutedInfo }) => {
  if (!mutedInfo) return;
  serialize(async () => {
    if (await hasOffscreen()) await audio("mute", { tabId, muted: mutedInfo.muted });
  }).catch(console.warn);
});

chrome.tabCapture.onStatusChanged.addListener((capture) => {
  const text = capture.status === "active" ? "ON" : "";
  chrome.action.setBadgeText({ tabId: capture.tabId, text }).catch(() => {});
  serialize(() => reflectCaptureFullscreen(capture)).catch(console.warn);
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) =>
  serialize(() => restoreWhenTabLeaves(tabId, windowId)).catch(console.warn));
chrome.tabs.onDetached.addListener((tabId) =>
  serialize(() => restoreWhenTabLeaves(tabId)).catch(console.warn));
chrome.tabs.onRemoved.addListener((tabId) =>
  serialize(() => restoreWhenTabLeaves(tabId)).catch(console.warn));
chrome.windows.onBoundsChanged.addListener(({ id }) =>
  serialize(() => forgetClosedOrExitedWindow(id)).catch(console.warn));
chrome.windows.onRemoved.addListener((id) =>
  serialize(() => forgetClosedOrExitedWindow(id)).catch(console.warn));

chrome.action.setBadgeBackgroundColor({ color: "#176657" }).catch(console.warn);
