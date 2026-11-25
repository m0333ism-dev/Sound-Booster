const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../extension/pcm-upmix-worklet.js"), "utf8");
const rate = 48000;

function render(amount, length, signal, update) {
  let Worklet;
  runInNewContext(source, {
    AudioWorkletProcessor: class { port = {}; },
    sampleRate: rate,
    registerProcessor: (_, processor) => { Worklet = processor; }
  });
  const processor = new Worklet({ processorOptions: { surround: amount } });
  const output = Array.from({ length: 8 }, () => new Float32Array(length));
  for (let offset = 0; offset < length; offset += 128) {
    update?.(processor, offset);
    const size = Math.min(length - offset, 128);
    const inputs = [new Float32Array(size), new Float32Array(size)];
    for (let i = 0; i < size; i++) {
      const [left, right] = signal(i + offset);
      inputs[0][i] = left;
      inputs[1][i] = right;
    }
    processor.process([inputs], [output.map((channel) => channel.subarray(offset, offset + size))]);
  }
  return output;
}

const peak = (samples) => samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
const sine = (frame, frequency) => Math.sin(2 * Math.PI * frequency * frame / rate);

test("centered content stays out of the sides and rears", () => {
  const output = render(100, 16000, (frame) => {
    const mono = 0.2 * sine(frame, 55);
    return [mono, mono];
  });
  assert.deepEqual(output[0], output[1]);
  assert.ok(peak(output[2]) > 0.105, "center");
  assert.ok(peak(output[3]) > 0.03, "LFE");
  assert.equal(peak(output[4]) + peak(output[5]) + peak(output[6]) + peak(output[7]), 0);
});

test("surround ambience has distinct sides and rears in Windows channel order", () => {
  const output = render(100, 1600, (frame) => frame === 0 ? [0.75, -0.75] : [0, 0]);
  assert.equal(peak(output[2]) + peak(output[3]), 0);
  const first = output.map((channel) => channel.findIndex((sample) => Math.abs(sample) > 1e-6));
  assert.deepEqual(first, [0, 0, -1, -1, 864, 1104, 336, 480]);
  assert.ok(output[6][336] > 0 && output[7][480] < 0);
});

test("zero amount preserves the stereo fronts and clears the derived channels", () => {
  const output = render(0, 3000, (frame) => [0.2 * sine(frame, 200), 0.3 * sine(frame, 700)]);
  assert.equal(output[0][30], Math.fround(0.2 * sine(30, 200)));
  assert.equal(output[1][30], Math.fround(0.3 * sine(30, 700)));
  assert.ok(output.slice(2).every((samples) => peak(samples) === 0));
});

test("all PCM channels honor the incoming ceiling while changing surround amount", () => {
  const ceiling = 10 ** (-8 / 20);
  const output = render(72, 24000, (frame) => [
    ceiling * Math.sign(sine(frame, 170)),
    ceiling * Math.sign(sine(frame, 307))
  ], (processor, offset) => {
    if (offset === 3072) processor.port.onmessage({ data: 100 });
    if (offset === 8192) processor.port.onmessage({ data: 0 });
  });
  for (const channel of output) assert.ok(peak(channel) <= ceiling + 1e-7);
});

test("routing requests eight channels only when the destination supports them", async () => {
  const { createOutputRouting } = await import("../extension/output-routing.js");
  const previous = global.AudioWorkletNode;
  class AudioNode {
    connections = new Set();
    connect(node) { this.connections.add(node); return node; }
    disconnect(node) { assert.ok(this.connections.delete(node)); }
  }
  let created;
  global.AudioWorkletNode = class extends AudioNode {
    port = {
      postMessage: (value) => { this.requestedAmount = value; },
      close: () => { this.closed = true; }
    };
    constructor(_context, name, options) {
      super();
      this.name = name;
      this.options = options;
      created = this;
    }
  };
  try {
    const destination = { channelCount: 2, maxChannelCount: 2, channelInterpretation: "speakers" };
    const processor = new AudioNode();
    const output = new AudioNode();
    const routing = createOutputRouting({ destination }, processor, output);
    const request = { outputMode: "pcm71", surround: 65 };
    routing.update(request);
    assert.equal(routing.channels, 2);
    assert.ok(processor.connections.has(output));
    assert.equal(created, undefined);
    destination.maxChannelCount = 8;
    routing.update(request);
    assert.equal(routing.channels, 8);
    assert.deepEqual(created.options.outputChannelCount, [8]);
    assert.deepEqual(created.options.processorOptions, { surround: 65 });
    assert.equal(destination.channelInterpretation, "discrete");
    assert.ok(processor.connections.has(created) && created.connections.has(output));
    routing.update({ ...request, surround: 80 });
    assert.equal(created.requestedAmount, 80);
    routing.update({ ...request, outputMode: "stereo" });
    assert.equal(routing.channels, 2);
    assert.ok(created.closed && processor.connections.has(output));
  } finally {
    global.AudioWorkletNode = previous;
  }
});
