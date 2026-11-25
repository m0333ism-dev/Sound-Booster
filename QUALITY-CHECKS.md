# Sound Booster 1.4.0 audio quality checks

November 25, 2026

## Same-input comparison

The old Chrome upmixer and new Windows companion received identical 48 kHz stereo PCM at **65% Surround amount**. Each excerpt was scaled once to a peak of −6 dBFS before both versions received it. This isolated the upmix from the listening presets and leveler.

| Excerpt | Front/center fold error, Chrome → Windows | Surround level on attacks, Chrome → Windows | Side pair peak absolute correlation, Chrome → Windows |
| --- | ---: | ---: | ---: |
| *Tears of Steel*, 0:15–0:45, bridge dialogue | 10.81% → <0.001% | −45.7 → −52.5 dB | 1.000 → 0.738 |
| *Tears of Steel*, 7:10–7:40, action | 10.20% → <0.001% | −34.3 → −42.1 dB | 1.000 → 0.795 |
| *Tears of Steel*, 9:55–10:25, credits score | 9.60% → <0.001% | −21.8 → −29.7 dB | 1.000 → 0.794 |
| *Sintel* trailer, 0:00–0:24 | 9.81% → <0.001% | −24.3 → −33.6 dB | 1.000 → 0.792 |

Front/center fold error measures the RMS difference from the original stereo after adding the center at −3 dB to each front. Attack levels are measured across the four surround channels during selected 40 ms onset windows and referenced to the original stereo in the same windows. Side correlation uses the largest absolute cross-correlation within ±30 ms. Lower correlation here indicates that the side signals are less like delayed copies of one another.

On the bridge excerpt, the difference between the studio stereo mix and its dialogue-free music/effects mix produced **7.6 dB less** side and rear energy with the Windows upmixer than with the Chrome version. The Windows version left the LFE channel silent and retained source bass in the fronts. Every output channel remained within the input ceiling. The quieter surrounds are a deliberate trade-off at the same slider setting.

Sources © Blender Foundation, CC BY 3.0. [Tears of Steel studio audio and dialogue-free mix](https://download.blender.org/demo/movies/ToS/) · [Sintel trailer source](https://media.w3.org/2010/05/sintel/trailer.mp4) · [Sintel license](https://durian.blender.org/sharing/)

## Playback through Windows DTS

Chrome 158 played parts of the three *Tears of Steel* excerpts through Sound Booster in an isolated profile with the **Detail** preset. The companion confirmed **two input channels and eight output channels at 48 kHz**. Windows reported **DTS Headphone:X** active on **Headphones (CR-8)**. The native stream rendered 430,560 frames by the score checkpoint, with zero underruns and dropped frames. The highest reported sample peak across the dialogue, action, and score checkpoints was −10.0 dBFS, below the preset’s −8 dBFS ceiling. Changing Surround amount while the stream was live and returning to original audio both passed. [Microsoft Spatial Sound rendering](https://learn.microsoft.com/en-us/windows/win32/coreaudio/render-spatial-sound-using-spatial-audio-objects)

The quality measurements describe the multichannel signal before DTS. The live check confirms delivery to the active renderer. A listening preference on the headset was outside these measurements.

## Sound Booster 1.5.0 dialogue follow-up

The revised Windows upmixer preserved the original left and right channels sample for sample and left the generated center and LFE silent. A controlled check used the *Tears of Steel* stereo master at 0:16–0:30. The test compared the same stereo difference signal with and without centered speech derived from another part of the excerpt. At 65% Surround amount, adding the centered signal lowered surround RMS by 17.94 dB during the voiced samples. [Tears of Steel studio audio](https://download.blender.org/demo/movies/ToS/)

Chrome played the dialogue on the CR-8 headphones with DTS Headphone:X active. Switching from **DTS Stereo** to **7.1 PCM · Windows** and back verified two, eight, and two spatial output channels respectively. The three checkpoints each showed 93,120 rendered frames, zero underruns, and zero dropped frames. **Clean** cleared quiet boost, detail lift, EQ, and overall volume boost. **Use original audio** released the tab successfully.

## Sound Booster 1.6.0 fullscreen and bass follow-up

In an isolated Chrome profile, double-clicking a video element with tab audio capture active reproduced element fullscreen while the browser window stayed normal. The updated extension made the browser window fullscreen and restored its prior normal or maximized state on exit. A window that was already fullscreen stayed fullscreen. DTS Headphone:X audio on the CR-8 headphones continued through the transitions. [Chromium fullscreen capture test](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/exclusive_access/fullscreen_controller_interactive_browsertest.cc)

At the default **+4 dB** setting in Windows spatial mode, Bass Recovery measured **+3.86 dB at 45 Hz** and **+0.0006 dB at 1 kHz**. On a *Tears of Steel* action excerpt, the same filter increased the band below about 85 Hz by **3.72 dB**, with a **0.002 dB** change in the band above about 550 Hz. The normal Stereo mode showed no gain change when the recovery setting was raised. These measurements describe the signal before DTS rendering. [Tears of Steel studio audio](https://download.blender.org/demo/movies/ToS/)
