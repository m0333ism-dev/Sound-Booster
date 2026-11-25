const pcmChannels = 8;

export function createPcmMixer(context, surround) {
  return new AudioWorkletNode(context, "pcm-upmix", {
    outputChannelCount: [pcmChannels],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { surround }
  });
}

export function createOutputRouting(context, processor, output) {
  const { destination } = context;
  let mixer;
  let isPcm = false;
  let amount;
  let maxChannels = destination.maxChannelCount;
  processor.connect(output);

  function update(settings) {
    maxChannels = destination.maxChannelCount;
    const requestPcm = settings.outputMode === "pcm71";
    let canUsePcm = requestPcm && maxChannels >= pcmChannels;
    if (canUsePcm && !isPcm) {
      try {
        mixer = createPcmMixer(context, settings.surround);
        destination.channelCount = pcmChannels;
        destination.channelInterpretation = "discrete";
      } catch {
        mixer?.port.close();
        mixer = undefined;
        canUsePcm = false;
      }
    }
    if (canUsePcm !== isPcm) {
      if (canUsePcm) {
        amount = settings.surround;
        processor.disconnect(output);
        processor.connect(mixer).connect(output);
      } else {
        processor.disconnect(mixer);
        mixer.disconnect(output);
        mixer.port.close();
        mixer = undefined;
        processor.connect(output);
        destination.channelInterpretation = "speakers";
        destination.channelCount = Math.min(maxChannels || 2, 2);
      }
      isPcm = canUsePcm;
    }
    if (isPcm && amount !== settings.surround) {
      amount = settings.surround;
      mixer.port.postMessage(amount);
    }
  }

  return {
    update,
    get channels() { return isPcm ? pcmChannels : destination.channelCount; },
    get maxChannels() { return maxChannels; }
  };
}
