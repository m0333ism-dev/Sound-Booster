import { defaultSettings, isWindowsSpatial, presets } from "./settings.js";

const statusText = document.querySelector("#status");
const errorText = document.querySelector("#error");
const toggle = document.querySelector("#toggle");
const inputMeter = document.querySelector("#input-meter");
const outputMeter = document.querySelector("#output-meter");
const limiterMeter = document.querySelector("#limiter-meter");
const presetSelect = document.querySelector("#preset");
const outputMode = document.querySelector("#outputMode");
const surroundControls = document.querySelector("#surround-controls");
const surroundHelp = document.querySelector("#surround-help");
const bassRecoveryControls = document.querySelector("#bass-recovery-controls");
const pcmStatus = document.querySelector("#pcm-status");
const resetEq = document.querySelector("#reset-eq");
const resetAll = document.querySelector("#reset-all");
const controls = Object.keys(defaultSettings).map((id) => document.getElementById(id));
let tabId;
let activeHere = false;
let available = false;
let pending = false;

async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: "worker", type, ...data });
  if (!response?.ok) throw new Error(response?.error || "Could not reach the audio controls.");
  return response.state;
}

function showError(message = "") {
  errorText.textContent = message;
  errorText.hidden = !message;
}

function formatLevel(control) {
  if (control === outputMode) return;
  const value = Number(control.value);
  const sign = value < 0 ? "−" : (value > 0 ? "+" : "");
  const unit = control.id === "ceilingDb" ? "dBFS" : "dB";
  const text = control.id === "surround" ? `${value}%` : `${sign}${Math.abs(value)} ${unit}`;
  document.getElementById(`${control.id}-value`).value = text;
  control.setAttribute("aria-valuetext", text);
}

function updateAvailability() {
  for (const control of controls) control.disabled = !available || pending;
  presetSelect.disabled = !available || pending;
  resetEq.disabled = resetAll.disabled = !available || pending;
  toggle.disabled = !available || pending;
}

function drawMeter(element, peak) {
  const fraction = Math.max(0, Math.min(1, 1 + 20 * Math.log10(peak || 0) / 54));
  element.style.transform = `scaleX(${fraction})`;
}

function drawState(state) {
  activeHere = state.tabId === tabId;
  const activeElsewhere = state.tabId !== null && !activeHere;
  const status = activeHere ? "Active on this tab" : (activeElsewhere ? "Active on another tab" : "Original tab audio");
  if (statusText.textContent !== status) statusText.textContent = status;
  statusText.dataset.active = toggle.dataset.active = String(activeHere);
  toggle.textContent = activeHere ? "Use original audio" : (activeElsewhere ? "Switch to this tab" : "Enable on this tab");
  drawMeter(inputMeter, activeHere ? state.input : 0);
  drawMeter(outputMeter, activeHere ? state.output : 0);
  limiterMeter.textContent = activeHere && state.limiterDb >= 0.5 ? `−${state.limiterDb.toFixed(1)} dB` : "—";
  drawPcmStatus(state);
}

function drawPcmStatus(state) {
  const mode = outputMode.value;
  pcmStatus.hidden = !isWindowsSpatial(mode);
  if (pcmStatus.hidden) return;
  const live = activeHere && state?.settings.outputMode === mode;
  const sampleRate = live ? ` · ${state.sampleRate / 1000} kHz` : "";
  const native = live ? state.native : null;
  const starting = native?.status === "connecting" || native?.status === "buffering";
  const nativeActive = native?.status === "active";
  const directPcm = mode === "pcm71" && state?.channels === 8 && !nativeActive;
  const fallback = live && !nativeActive && !directPcm && !starting;
  let message = "Enable on this tab to check Chrome's output.";
  if (starting) message = "Starting Windows Spatial Sound…";
  if (nativeActive) {
    const layout = native.channels === 2 ? "Stereo" : "7.1";
    message = `${native.renderer || "Windows Spatial Sound"} · ${layout}${sampleRate} · ${native.device}`;
  } else if (live && directPcm) {
    message = `8-channel Chrome PCM${sampleRate}.`;
  }
  if (fallback) {
    const reason = mode === "dtsStereo" ? "Windows spatial stereo unavailable."
      : state.maxChannels > 0 && state.maxChannels < 8
      ? `Chrome exposes ${state.maxChannels} channels.`
      : "Chrome couldn't open 8-channel output.";
    message = `${reason} Playing stereo.`;
  }
  pcmStatus.title = native?.message || (nativeActive
    ? (native.channels === 2 ? "Only the front left and right speakers are active."
      : "Stereo enters the Windows companion and is upmixed there.") : "");
  pcmStatus.dataset.fallback = String(Boolean(fallback));
  if (pcmStatus.textContent !== message) pcmStatus.textContent = message;
}

function currentSettings() {
  return Object.fromEntries(controls.map((control) => [
    control.id, control === outputMode ? control.value : Number(control.value)
  ]));
}

function refreshControls() {
  const settings = currentSettings();
  const preset = Object.entries(presets).find(([, values]) =>
    Object.entries(values).every(([key, value]) => settings[key] === value));
  presetSelect.value = preset?.[0] || "custom";
  surroundControls.hidden = !["pcm71", "surround"].includes(settings.outputMode);
  bassRecoveryControls.hidden = !isWindowsSpatial(settings.outputMode);
  surroundHelp.textContent = settings.outputMode === "pcm71"
    ? "Adjust the ambience added to the sides and rear."
    : "For one spatial effect at a time, turn off Windows spatial sound.";
  return settings;
}

function saveControls() {
  request("settings", { levels: refreshControls() }).catch((error) => showError(error.message));
}

function setControls(values) {
  for (const [key, value] of Object.entries(values)) {
    const control = document.getElementById(key);
    control.value = value;
    formatLevel(control);
  }
}

resetEq.addEventListener("click", () => {
  setControls({ bassDb: defaultSettings.bassDb, presenceDb: defaultSettings.presenceDb, trebleDb: defaultSettings.trebleDb });
  saveControls();
});

resetAll.addEventListener("click", () => {
  setControls(defaultSettings);
  drawPcmStatus();
  saveControls();
});

for (const control of controls) {
  control.addEventListener("input", () => {
    formatLevel(control);
    if (control === outputMode) drawPcmStatus();
    saveControls();
  });
}

presetSelect.addEventListener("change", () => {
  const preset = presets[presetSelect.value];
  if (!preset) return;
  setControls(preset);
  saveControls();
});

toggle.addEventListener("click", async () => {
  pending = true;
  updateAvailability();
  showError();
  try {
    await request(activeHere ? "stop" : "start", { tabId });
    drawState(await request("status"));
  } catch (error) {
    showError(error.message);
  } finally {
    pending = false;
    updateAvailability();
  }
});

async function poll() {
  try {
    if (!pending) {
      const state = await request("status");
      if (!pending) drawState(state);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setTimeout(poll, 240);
  }
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) throw new Error("No active tab is available.");
  tabId = tab.id;
  const state = await request("status");
  setControls(state.settings);
  refreshControls();
  drawState(state);
  available = true;
  updateAvailability();
  setTimeout(poll, 240);
}

initialize().catch((error) => {
  statusText.textContent = "Unavailable";
  showError(error.message);
});
