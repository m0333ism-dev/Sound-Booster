import { isWindowsSpatial } from "./settings.js";

function filter(context, type, frequency, gain = 0, q = 0.707) {
  return new BiquadFilterNode(context, { type, frequency, gain, Q: q });
}

function virtualSpeaker(context, degrees) {
  const radians = degrees * Math.PI / 180;
  return new PannerNode(context, {
    panningModel: "HRTF",
    rolloffFactor: 0,
    positionX: Math.sin(radians),
    positionY: 0,
    positionZ: -Math.cos(radians)
  });
}

function createVirtualSpeakers(context, destination) {
  const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
  splitter.connect(virtualSpeaker(context, -32), 0).connect(destination);
  splitter.connect(virtualSpeaker(context, 32), 1).connect(destination);

  // Extract ambience from L−R. In-phase center content cancels at this input.
  const side = new GainNode(context, { channelCount: 1, channelCountMode: "explicit", gain: 0.18 });
  splitter.connect(side, 0);
  splitter.connect(new GainNode(context, { gain: -1 }), 1).connect(side);
  const highpass = filter(context, "highpass", 190);
  const lowpass = filter(context, "lowpass", 4800);
  side.connect(highpass).connect(lowpass);
  lowpass.connect(new DelayNode(context, { maxDelayTime: 0.05, delayTime: 0.009 }))
    .connect(virtualSpeaker(context, -122)).connect(destination);
  lowpass.connect(new GainNode(context, { gain: -1 }))
    .connect(new DelayNode(context, { maxDelayTime: 0.05, delayTime: 0.013 }))
    .connect(virtualSpeaker(context, 122)).connect(destination);

  return splitter;
}

export function createAudioEffects(context, source, destination, settings) {
  const bass = filter(context, "lowshelf", 120, settings.bassDb);
  const presence = filter(context, "peaking", 2350, settings.presenceDb, 0.88);
  const treble = filter(context, "highshelf", 6500, settings.trebleDb);
  const bassRecovery = filter(context, "lowshelf", 110);
  const dry = new GainNode(context);
  const wet = new GainNode(context, { gain: 0 });
  source.connect(bass).connect(presence).connect(treble).connect(bassRecovery).connect(dry).connect(destination);
  let spatialInput;
  let spatialConnected = false;
  let idleTimer;

  function dropSpatial() {
    if (!spatialConnected) return;
    wet.disconnect();
    bassRecovery.disconnect(spatialInput);
    spatialConnected = false;
  }

  function update(next, immediate = false) {
    clearTimeout(idleTimer);
    const now = context.currentTime;
    // Leave some of the direct signal present to retain a stable center image.
    const mix = next.outputMode === "surround" ? next.surround * 0.008 : 0;
    if (mix > 0 && !spatialConnected) {
      spatialInput ??= createVirtualSpeakers(context, wet);
      bassRecovery.connect(spatialInput);
      wet.connect(destination);
      spatialConnected = true;
    }
    for (const [param, value] of [
      [bass.gain, next.bassDb], [presence.gain, next.presenceDb], [treble.gain, next.trebleDb],
      [bassRecovery.gain, isWindowsSpatial(next.outputMode) ? next.bassRecoveryDb : 0],
      [dry.gain, 1 - mix], [wet.gain, mix]
    ]) {
      if (immediate) {
        param.value = value;
      } else {
        param.setTargetAtTime(value, now, 0.025);
      }
    }
    if (mix === 0 && spatialConnected) idleTimer = setTimeout(dropSpatial, 250);
  }

  update(settings, true);
  return {
    update,
    close() {
      clearTimeout(idleTimer);
      dropSpatial();
    }
  };
}
