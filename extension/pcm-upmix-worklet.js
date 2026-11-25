class PcmUpmix extends AudioWorkletProcessor {
  constructor({ processorOptions: { surround } }) {
    super();
    this.amount = this.target = surround / 100;
    this.mixSlew = 1 - Math.exp(-1 / (sampleRate * 0.03));
    this.bassSlew = 1 - Math.exp(-2 * Math.PI * 105 / sampleRate);
    this.ambienceHighpass = 1 - Math.exp(-2 * Math.PI * 170 / sampleRate);
    this.ambienceLowpass = 1 - Math.exp(-2 * Math.PI * 6500 / sampleRate);
    this.delays = [0.007, 0.010, 0.018, 0.023].map((seconds) => Math.round(sampleRate * seconds));
    this.ambience = new Float32Array(this.delays[3] + 1);
    this.index = 0;
    this.bass = this.sideBass = this.side = 0;
    this.port.onmessage = ({ data }) => { this.target = data / 100; };
  }

  process(inputs, outputs) {
    const [left, right = left] = inputs[0];
    // Windows 7.1 Surround order (channel mask 0x63F).
    const [frontL, frontR, center, lfe, backL, backR, sideL, sideR] = outputs[0];
    const [leftSideDelay, rightSideDelay, leftBackDelay, rightBackDelay] = this.delays;
    const { ambience } = this;
    const bufferSize = ambience.length;
    for (let frame = 0; frame < frontL.length; frame++) {
      const l = left?.[frame] ?? 0;
      const r = right?.[frame] ?? 0;
      const mid = 0.5 * (l + r);
      const difference = 0.5 * (l - r);
      this.amount += (this.target - this.amount) * this.mixSlew;
      this.bass += (mid - this.bass) * this.bassSlew;
      this.sideBass += (difference - this.sideBass) * this.ambienceHighpass;
      // Both the side input and the low-pass state are bounded by the stereo
      // ceiling. Halve their difference to keep the ambience under that ceiling.
      this.side += (0.5 * (difference - this.sideBass) - this.side) * this.ambienceLowpass;
      ambience[this.index] = this.side;
      const amount = this.amount;
      const offset = this.index + bufferSize;
      // Absolute coefficients sum to one for the fronts. The generated rows
      // use bounded filters and gains below one, so none can exceed the input ceiling.
      frontL[frame] = l - 0.22 * amount * mid;
      frontR[frame] = r - 0.22 * amount * mid;
      center[frame] = 0.55 * amount * mid;
      lfe[frame] = 0.22 * amount * this.bass;
      sideL[frame] = 0.90 * amount * ambience[(offset - leftSideDelay) % bufferSize];
      sideR[frame] = -0.90 * amount * ambience[(offset - rightSideDelay) % bufferSize];
      backL[frame] = 0.62 * amount * ambience[(offset - leftBackDelay) % bufferSize];
      backR[frame] = -0.62 * amount * ambience[(offset - rightBackDelay) % bufferSize];
      this.index = (this.index + 1) % bufferSize;
    }
    return true;
  }
}

registerProcessor("pcm-upmix", PcmUpmix);
