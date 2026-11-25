const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../extension/leveler-worklet.js"), "utf8");
const defaults = { volumeDb: 0, boostDb: 9, ceilingDb: -6 };
const gain = (db) => 10 ** (db / 20);

function createWorklet(sampleRate, settings = {}) {
  let Worklet;
  const meters = [];
  runInNewContext(source, {
    AudioWorkletProcessor: class { port = { postMessage: (entry) => meters.push(entry) }; },
    sampleRate,
    registerProcessor: (_, processor) => { Worklet = processor; }
  });
  return { processor: new Worklet({ processorOptions: { ...defaults, ...settings } }), meters };
}

function render(processor, frames, signal, stereo = true) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  // Include different render block sizes to catch ring-buffer boundary errors.
  for (let offset = 0; offset < frames; offset += 127) {
    const size = Math.min(127, frames - offset);
    const channel = Float32Array.from({ length: size }, (_, index) => signal(index + offset));
    const input = stereo ? [channel, channel.map((sample) => sample * -0.37)] : [channel];
    processor.process([input], [[left.subarray(offset, offset + size), right.subarray(offset, offset + size)]]);
  }
  return { left, right };
}

function peak(samples, start = 0) {
  return samples.subarray(start).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

for (const rate of [44100, 48000, 96000]) {
  test(`quiet lift and overall gain are independent at ${rate} Hz`, () => {
    const frames = Math.floor(rate * 1.2);
    const sine = (index) => Math.sin(2 * Math.PI * 1000 * index / rate);
    const quiet = (index) => sine(index) * 0.02;
    const normal = (index) => sine(index) * 0.32;
    const quietResult = render(createWorklet(rate).processor, frames, quiet, false);
    const normalResult = render(createWorklet(rate).processor, frames, normal);
    const masterResult = render(createWorklet(rate, { boostDb: 0, volumeDb: 12 }).processor, frames, quiet);
    assert.ok(peak(quietResult.left, rate) > 0.02 * gain(8.9));
    assert.deepEqual(quietResult.left, quietResult.right, "mono is sent to both outputs");
    assert.ok(Math.abs(peak(normalResult.left, rate) - 0.32) < 0.001);
    assert.ok(Math.abs(peak(masterResult.left, rate) - 0.02 * gain(12)) < 0.001);
  });

  test(`ceiling holds for transients and sustained action at ${rate} Hz`, () => {
    const { processor, meters } = createWorklet(rate, { volumeDb: 24 });
    const signal = (index) => {
      if (index === rate - 1 || index === rate + 111) return 1;
      if (index > 1.2 * rate) return Math.sin(2 * Math.PI * 173 * index / rate) * 0.9;
      return Math.sin(2 * Math.PI * 700 * index / rate) * 0.02;
    };
    const { left, right } = render(processor, 2 * rate, signal);
    assert.ok(peak(left) <= gain(-6) + 1e-7);
    assert.ok(peak(left) > gain(-6) - 0.001);
    assert.ok(left.every((sample, index) => Math.abs(right[index] + 0.37 * sample) < 1e-7));
    assert.ok(meters.some((entry) => entry.input === 1 && entry.output > 0.49));
  });
}

test("the lookahead begins gain reduction before an impulse and releases afterward", () => {
  const rate = 48000;
  const impulse = 3000;
  const { processor } = createWorklet(rate, { boostDb: 0 });
  const { left } = render(processor, 50000, (frame) => (frame === impulse ? 1 : 0.1));
  const arrival = impulse + processor.lookahead;
  assert.ok(left[arrival - 1] < 0.075);
  assert.ok(left[impulse - 1] > 0.099);
  assert.ok(Math.abs(left[arrival] - gain(-6)) < 1e-7);
  assert.ok(left.at(-1) > 0.099);
});

test("changing the ceiling takes effect smoothly and silence stays silent", () => {
  const { processor } = createWorklet(48000, { volumeDb: 24 });
  assert.equal(peak(render(processor, 4800, () => 0).left), 0);
  render(processor, 24000, () => 0.6);
  processor.port.onmessage({ data: { volumeDb: 24, boostDb: 18, ceilingDb: -18 } });
  const { left } = render(processor, 16000, () => 0.6);
  assert.ok(peak(left) <= gain(-6) + 1e-7);
  assert.ok(peak(left, 12000) <= gain(-18) + 0.00005);
  assert.ok(Math.abs(left[1] - left[0]) < 0.001);
});

test("detail lift brings out soft low and high effects across an active midrange", () => {
  const rate = 48000;
  const frames = Math.round(rate * 0.65);
  const start = Math.round(rate * 0.45);
  const end = start + Math.round(rate * 0.05);
  const sine = (frequency, frame) => Math.sin(2 * Math.PI * frequency * frame / rate);
  const signal = (frame) => {
    const middle = sine(1400, frame) * 0.18;
    if (frame < start || frame >= end) return middle;
    return middle + 0.014 * sine(100, frame) + 0.012 * sine(5600, frame);
  };
  const base = render(createWorklet(rate, { boostDb: 0 }).processor, frames, signal).left;
  const detail = render(createWorklet(rate, { boostDb: 0, detailDb: 12 }).processor, frames, signal).left;
  const delay = Math.round(rate * 0.005);
  function amplitude(buffer, frequency, from = start + 1200, to = end) {
    let re = 0;
    let im = 0;
    for (let frame = from; frame < to; frame++) {
      re += buffer[frame + delay] * sine(frequency, frame);
      im += buffer[frame + delay] * sine(frequency, frame + rate / (4 * frequency));
    }
    return 2 * Math.hypot(re, im) / (to - from);
  }
  for (const frequency of [100, 5600]) assert.ok(amplitude(detail, frequency) > amplitude(base, frequency) * 1.14);
  assert.ok(amplitude(detail, 1400) < amplitude(base, 1400) * 1.45);
});

test("detail, overall boost, and quiet boost still share one peak ceiling", () => {
  const { processor, meters } = createWorklet(48000, {
    detailDb: 12, boostDb: 18, volumeDb: 24, ceilingDb: -9
  });
  const { left, right } = render(processor, 24000, (frame) => {
    return frame === 11000 ? 1 : Math.sin(frame * 0.53) * (frame < 12000 ? 0.012 : 0.65);
  });
  assert.ok(peak(left) <= gain(-9) + 1e-7);
  assert.ok(peak(left) > gain(-9) - 0.001);
  assert.ok(left.every((sample, index) => Math.abs(right[index] + 0.37 * sample) < 1e-7));
  assert.ok(meters.some((entry) => entry.limiterDb > 20));
});
