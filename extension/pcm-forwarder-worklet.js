const packetFrames = 512;
const channels = 2;

class PcmForwarder extends AudioWorkletProcessor {
  packet = new Float32Array(packetFrames * channels);
  position = 0;

  process(inputs, outputs) {
    const input = inputs[0];
    const [silentOutput] = outputs[0];
    for (let frame = 0; frame < silentOutput.length; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        this.packet[this.position++] = input[channel]?.[frame] ?? 0;
      }
      if (this.position === this.packet.length) {
        this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
        this.packet = new Float32Array(packetFrames * channels);
        this.position = 0;
      }
    }
    // The connected Web Audio output drives the worklet clock and stays silent.
    return true;
  }
}

registerProcessor("pcm-forwarder", PcmForwarder);
