import { createAudioEffects } from "./audio-effects.js";
import { createOutputRouting } from "./output-routing.js";
import { createNativeRoute } from "./native-route.js";
import { isWindowsSpatial } from "./settings.js";

let session = null;

async function release(current) {
  if (!current) return;
  if (session === current) session = null;
  current.native?.close();
  current.effects?.close();
  current.output?.disconnect();
  current.stream?.getTracks().forEach((track) => track.stop());
  if (current.context && current.context.state !== "closed") await current.context.close();
}

async function start({ tabId, streamId, settings, muted }) {
  const current = { tabId, input: 0, outputPeak: 0, settings };
  let timeout;
  try {
    current.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false
    });
    const [track] = current.stream.getAudioTracks();
    if (!track) throw new Error("Chrome returned no audio track for this tab.");

    const context = current.context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    await Promise.all([
      context.audioWorklet.addModule("leveler-worklet.js"),
      context.audioWorklet.addModule("pcm-upmix-worklet.js"),
      context.audioWorklet.addModule("pcm-forwarder-worklet.js")
    ]);
    const processor = current.processor = new AudioWorkletNode(context, "dialogue-leveler", {
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: settings
    });
    const output = current.output = context.createGain();
    const localOutput = current.localOutput = context.createGain();
    output.connect(localOutput);
    output.gain.value = muted ? 0 : 1;
    const source = context.createMediaStreamSource(current.stream);
    current.effects = createAudioEffects(context, source, processor, settings);
    current.routing = createOutputRouting(context, processor, output);
    current.native = createNativeRoute(context, output, localOutput, () => {
      current.routing.update(current.settings);
    });
    await Promise.race([
      context.resume(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Chrome did not start audio playback.")), 2500);
      })
    ]);
    if (track.readyState !== "live") throw new Error("The tab stopped sharing its audio.");
    processor.port.onmessage = ({ data }) => {
      current.input = data.input;
      current.outputPeak = data.output;
      current.limiterDb = data.limiterDb;
    };
    const end = () => release(current).catch(console.warn);
    track.addEventListener("ended", end, { once: true });
    processor.addEventListener("processorerror", end, { once: true });
    context.addEventListener("sinkchange", () => updateOutput(current));

    const previous = session;
    session = current;
    localOutput.connect(context.destination);
    await release(previous);
    updateOutput(current);
  } catch (error) {
    await release(current);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function updateOutput(current) {
  const settings = current.settings;
  const windowsSpatial = isWindowsSpatial(settings.outputMode);
  current.native.update(windowsSpatial ? settings.outputMode : null, settings.surround);
  current.routing.update(windowsSpatial && current.native.details.status !== "unavailable"
    ? { ...settings, outputMode: "stereo" } : settings);
}

async function handle(message) {
  if (message.type === "start") await start(message);
  if (message.type === "settings" && session) {
    session.settings = message.settings;
    session.effects.update(message.settings);
    updateOutput(session);
    session.processor.port.postMessage(message.settings);
  }
  if (session && session.tabId === message.tabId) {
    if (message.type === "stop") await release(session);
    if (message.type === "mute") {
      session.output.gain.setTargetAtTime(message.muted ? 0 : 1, session.context.currentTime, 0.008);
    }
  }
  return session
    ? {
        tabId: session.tabId,
        input: session.input,
        output: session.outputPeak * session.output.gain.value,
        limiterDb: session.limiterDb,
        channels: session.native.details.status === "active" ? session.native.details.channels : session.routing.channels,
        maxChannels: session.routing.maxChannels,
        sampleRate: session.context.sampleRate,
        native: session.native.details
      }
    : { tabId: null };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "audio" || sender.url !== chrome.runtime.getURL("background.js")) return false;
  handle(message).then(
    (state) => respond({ ok: true, state }),
    (error) => respond({ ok: false, error: error.message })
  );
  return true;
});
