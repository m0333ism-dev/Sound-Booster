const key = "managedVideoFullscreen";

async function ownership() {
  return (await chrome.storage.session.get(key))[key];
}

async function restore(owner) {
  const window = await chrome.windows.get(owner.windowId).catch(() => undefined);
  if (window?.state === "fullscreen") {
    await chrome.windows.update(owner.windowId, { state: owner.previousState });
  }
  await chrome.storage.session.remove(key);
}

export async function reflectCaptureFullscreen({ tabId, status, fullscreen }) {
  const owner = await ownership();
  if (status !== "active" || !fullscreen) {
    if (owner?.tabId === tabId) await restore(owner);
    return;
  }
  if (owner?.tabId === tabId) return;

  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab?.active) return;
  if (owner) await restore(owner);
  const window = await chrome.windows.get(tab.windowId).catch(() => undefined);
  if (window?.type !== "normal" || !["normal", "maximized"].includes(window.state)) return;

  // Captured tabs enter element fullscreen without changing the browser window.
  await chrome.storage.session.set({ [key]: { tabId, windowId: tab.windowId, previousState: window.state } });
  try {
    await chrome.windows.update(tab.windowId, { state: "fullscreen" });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
}

export async function restoreWhenTabLeaves(tabId, windowId) {
  const owner = await ownership();
  if (!owner) return;
  const removed = windowId === undefined && owner.tabId === tabId;
  const switched = owner.windowId === windowId && owner.tabId !== tabId;
  if (removed || switched) await restore(owner);
}

export async function forgetClosedOrExitedWindow(windowId) {
  const owner = await ownership();
  if (owner?.windowId !== windowId) return;
  const window = await chrome.windows.get(windowId).catch(() => undefined);
  if (window?.state !== "fullscreen") await chrome.storage.session.remove(key);
}
