const toGain = (db) => Math.pow(10, db / 20);
const clampUnit = (value) => Math.min(1, Math.max(0, value));

class DetailBand {
  power = 0;
  gain = 1;
  left = 0;
  right = 0;

  apply(left, right, amount) {
    const peak = Math.max(Math.abs(left), Math.abs(right));
    const power = peak * peak;
    this.power += (power - this.power) * (power > this.power ? this.attack : this.release);
    const level = 10 * Math.log10(Math.max(1e-12, this.power));
    // Taper out for near-silent material and for bands that already stand out.
    const lift = clampUnit((level + 66) / 17) * clampUnit((-20 - level) / 21);
    this.gain += (toGain(amount * lift) - this.gain) * this.gainSlew;
    // Return only the added signal so flat gain sums to the original sample.
    this.left = left * (this.gain - 1);
    this.right = right * (this.gain - 1);
  }

  constructor(coefficient) {
    this.attack = coefficient(0.004);
    this.release = coefficient(0.065);
    this.gainSlew = coefficient(0.009);
  }
}

class DialogueLeveler extends AudioWorkletProcessor {
  constructor({ processorOptions: settings }) {
    super();
    this.boostDb = settings.boostDb;
    this.detailDb = this.targetDetailDb = settings.detailDb ?? 0;
    this.detailSlew = this.coefficient(0.02);
    this.lowPole = this.coefficient(1 / (2 * Math.PI * 240));
    this.highPole = this.coefficient(1 / (2 * Math.PI * 3600));
    this.lowL = this.lowR = this.belowHighL = this.belowHighR = 0;
    this.lowBand = new DetailBand(this.coefficient);
    this.midBand = new DetailBand(this.coefficient);
    this.highBand = new DetailBand(this.coefficient);
    this.volume = this.targetVolume = toGain(settings.volumeDb);
    this.ceiling = this.targetCeiling = toGain(settings.ceilingDb);
    this.gain = this.limiterGain = 1;
    this.envelope = 0;
    this.frame = 0;
    this.lookahead = Math.round(sampleRate * 0.005);
    this.windowSize = this.lookahead + 1;
    this.delay = [new Float64Array(this.windowSize), new Float64Array(this.windowSize)];
    // Ring-buffer deque of peaks, largest first. One spare slot distinguishes full from empty.
    this.peakValues = new Float64Array(this.windowSize + 1);
    this.peakFrames = new Float64Array(this.peakValues.length);
    this.peakHead = this.peakTail = 0;
    this.gainHistory = new Float64Array(this.windowSize).fill(1);
    this.gainSum = this.windowSize;
    this.powerAttack = this.coefficient(0.012);
    this.powerRelease = this.coefficient(0.18);
    this.boostAttack = this.coefficient(0.18);
    this.boostRelease = this.coefficient(0.015);
    this.limiterRelease = this.coefficient(0.10);
    this.volumeSlew = this.coefficient(0.03);
    this.ceilingSlew = this.coefficient(0.025);
    this.inputPeak = this.outputPeak = 0;
    this.minimumLimiterGain = 1;
    this.meterInterval = Math.round(sampleRate / 10);
    this.nextMeter = this.meterInterval;
    this.port.onmessage = ({ data }) => {
      this.boostDb = data.boostDb;
      this.targetDetailDb = data.detailDb ?? 0;
      this.targetVolume = toGain(data.volumeDb);
      this.targetCeiling = toGain(data.ceilingDb);
    };
  }

  coefficient(seconds) {
    return 1 - Math.exp(-1 / (sampleRate * seconds));
  }

  updatePeak(peak, frame) {
    const { peakValues, peakFrames, lookahead } = this;
    const size = peakValues.length;
    let { peakHead: head, peakTail: tail } = this;
    while (head !== tail && peakFrames[head] < frame - lookahead) {
      head = (head + 1) % size;
    }
    while (head !== tail) {
      const previous = (tail + size - 1) % size;
      if (peakValues[previous] > peak) break;
      tail = previous;
    }
    peakFrames[tail] = frame;
    peakValues[tail] = peak;
    this.peakHead = head;
    this.peakTail = (tail + 1) % size;
    return peakValues[head];
  }

  liftDetail(l, r) {
    this.lowL += (l - this.lowL) * this.lowPole;
    this.lowR += (r - this.lowR) * this.lowPole;
    this.belowHighL += (l - this.belowHighL) * this.highPole;
    this.belowHighR += (r - this.belowHighR) * this.highPole;
    this.lowBand.apply(this.lowL, this.lowR, this.detailDb);
    this.midBand.apply(this.belowHighL - this.lowL, this.belowHighR - this.lowR, this.detailDb);
    this.highBand.apply(l - this.belowHighL, r - this.belowHighR, this.detailDb);
  }

  process(inputs, outputs) {
    const [left, right = left] = inputs[0];
    const [outLeft, outRight] = outputs[0];
    const { delay, windowSize, gainHistory } = this;
    for (let sample = 0; sample < outLeft.length; sample++) {
      const l = left?.[sample] ?? 0;
      const r = right?.[sample] ?? 0;
      const inputPeak = Math.max(Math.abs(l), Math.abs(r));
      const power = inputPeak * inputPeak;
      const powerSlew = power > this.envelope ? this.powerAttack : this.powerRelease;
      this.envelope += (power - this.envelope) * powerSlew;
      const level = 10 * Math.log10(Math.max(1e-12, this.envelope));
      // Fade the lift out near silence and as the signal approaches normal dialogue level.
      const lift = clampUnit((level + 70) / 18) * clampUnit((-14 - level) / 20);
      const desiredGain = toGain(this.boostDb * lift);
      const gainSlew = desiredGain > this.gain ? this.boostAttack : this.boostRelease;
      this.gain += (desiredGain - this.gain) * gainSlew;
      this.volume += (this.targetVolume - this.volume) * this.volumeSlew;
      const combinedGain = this.gain * this.volume;
      this.ceiling += (this.targetCeiling - this.ceiling) * this.ceilingSlew;

      this.detailDb += (this.targetDetailDb - this.detailDb) * this.detailSlew;
      let detailedL = l;
      let detailedR = r;
      if (this.detailDb > 0.001) {
        this.liftDetail(l, r);
        detailedL += this.lowBand.left + this.midBand.left + this.highBand.left;
        detailedR += this.lowBand.right + this.midBand.right + this.highBand.right;
      }
      const slot = this.frame % windowSize;
      delay[0][slot] = detailedL * combinedGain;
      delay[1][slot] = detailedR * combinedGain;
      const peak = this.updatePeak(Math.max(Math.abs(delay[0][slot]), Math.abs(delay[1][slot])), this.frame);
      const wanted = peak > this.ceiling ? this.ceiling / peak : 1;
      this.limiterGain = Math.min(wanted, this.limiterGain + (1 - this.limiterGain) * this.limiterRelease);
      // Average the gain over the lookahead window for a smooth attack. The delayed
      // sample was visible to the peak detector for each gain in this average.
      this.gainSum += this.limiterGain - gainHistory[slot];
      gainHistory[slot] = this.limiterGain;
      const delayed = (slot + 1) % windowSize;
      const delayedPeak = Math.max(Math.abs(delay[0][delayed]), Math.abs(delay[1][delayed]));
      // During a ceiling adjustment, use the lower linked gain required by the new limit.
      const outputGain = Math.min(this.gainSum / windowSize, delayedPeak > this.ceiling ? this.ceiling / delayedPeak : 1);
      outLeft[sample] = delay[0][delayed] * outputGain;
      outRight[sample] = delay[1][delayed] * outputGain;
      this.inputPeak = Math.max(this.inputPeak, inputPeak);
      this.outputPeak = Math.max(this.outputPeak, Math.abs(outLeft[sample]), Math.abs(outRight[sample]));
      this.minimumLimiterGain = Math.min(this.minimumLimiterGain, outputGain);
      this.frame++;
    }
    if (this.frame >= this.nextMeter) {
      this.port.postMessage({
        input: this.inputPeak,
        output: this.outputPeak,
        limiterDb: -20 * Math.log10(this.minimumLimiterGain)
      });
      this.nextMeter += this.meterInterval;
      this.inputPeak = this.outputPeak = 0;
      this.minimumLimiterGain = 1;
    }
    return true;
  }
}

registerProcessor("dialogue-leveler", DialogueLeveler);
