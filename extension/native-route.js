export function createNativeRoute(context, input, localOutput, onUnavailable) {
  let port;
  let forwarder;
  let wired = false;
  let timeout;
  let amount;
  let wanted = null;
  let details = { status: "idle" };

  function close() {
    clearTimeout(timeout);
    const previous = port;
    port = undefined;
    previous?.disconnect();
    if (forwarder) {
      if (wired) input.disconnect(forwarder);
      forwarder.disconnect();
      forwarder.port.close();
      forwarder = undefined;
    }
    wired = false;
    if (context.state !== "closed") localOutput.gain.setTargetAtTime(1, context.currentTime, 0.005);
  }

  function fail(message) {
    close();
    details = { status: "unavailable", message };
    onUnavailable();
  }

  function start(mode) {
    details = { status: "connecting" };
    const connection = port = chrome.runtime.connect({ name: "windows-spatial" });
    timeout = setTimeout(() => {
      if (port === connection) fail("The Windows audio companion did not start.");
    }, 3500);
    connection.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (port === connection) fail(error || "The Windows audio companion disconnected.");
    });
    connection.onMessage.addListener((message) => {
      if (port !== connection) return;
      if (message.type === "error") {
        fail(message.message);
      } else if (message.type === "ready" && details.status === "connecting") {
        if (message.channels !== (mode === "dtsStereo" ? 2 : 8)) {
          fail("The Windows companion did not open the requested speaker layout.");
          return;
        }
        clearTimeout(timeout);
        try {
          forwarder = new AudioWorkletNode(context, "pcm-forwarder", {
            channelCount: 2,
            channelCountMode: "explicit",
            outputChannelCount: [1]
          });
          const onError = () => {
            if (port === connection) fail("Chrome's PCM transport stopped.");
          };
          forwarder.addEventListener("processorerror", onError, { once: true });
          forwarder.port.onmessage = ({ data }) => {
            if (port !== connection) return;
            try {
              const bytes = new Uint8Array(data);
              connection.postMessage({ type: "audio", data: btoa(String.fromCharCode(...bytes)) });
            } catch (error) {
              fail(error.message);
            }
          };
          input.connect(forwarder);
          wired = true;
          forwarder.connect(context.destination);
          // Keep the local output until the native renderer has consumed audio.
          details = {
            status: "buffering", device: message.device, renderer: message.renderer,
            channels: message.channels, inputChannels: message.inputChannels
          };
          timeout = setTimeout(() => {
            if (port === connection) fail("The Windows companion received no buffered audio.");
          }, 2200);
        } catch (error) {
          fail(error.message);
        }
      } else if (message.type === "playing" && details.status === "buffering") {
        clearTimeout(timeout);
        localOutput.gain.setTargetAtTime(0, context.currentTime, 0.005);
        details = { ...details, status: "active" };
      } else if (message.type === "stats" && details.status === "active") {
        const { renderedFrames, peak, bufferedFrames, droppedFrames, underruns } = message;
        details = { ...details, renderedFrames, peak, bufferedFrames, droppedFrames, underruns };
      }
    });
    connection.postMessage({
      type: "start", version: 2, sampleRate: 48000, channels: 2, surround: amount,
      stereoOnly: mode === "dtsStereo"
    });
  }

  return {
    update(mode, surround) {
      if (amount !== surround) {
        amount = surround;
        if (port && mode === "pcm71" && wanted === mode) {
          try { port.postMessage({ type: "mix", surround: amount }); }
          catch (error) { fail(error.message); }
        }
      }
      if (wanted === mode) return;
      wanted = mode;
      close();
      details = { status: "idle" };
      if (mode) {
        try { start(mode); } catch (error) { fail(error.message); }
      }
    },
    get details() { return details; },
    close
  };
}
