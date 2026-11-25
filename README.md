# Sound Booster

Sound Booster is a Chrome extension for movies and streams where quiet dialogue or effects get lost between loud scenes. It adjusts one tab at a time.

## Install

1. Open `chrome://extensions` in Chrome 116 or later.
2. Turn on **Developer mode**, select **Load unpacked**, and choose this project's `extension` folder.
3. Open a video, click **Sound Booster** in Chrome’s toolbar or Extensions menu, and select **Enable on this tab**.

The effect stays active after the popup closes. **Use original audio** releases the tab and restores Chrome's normal playback path. **Switch to this tab** moves processing from the previous tab. If Chrome confines a captured video to fullscreen inside the tab, Sound Booster expands the browser window and restores its previous state when video fullscreen ends. The controls remember your settings locally.

## Controls

| Control | Default | Use |
| --- | --- | --- |
| Quiet boost | +9 dB | Lifts quieter passages in the mix. The boost tapers off on loud passages and near silence. |
| Detail lift | 0 dB | Lifts softer content separately in the bass, midrange, and treble. Try the **Detail** preset for quiet thuds, clicks, and speech alongside louder sounds. |
| Overall volume | 0 dB | Increase it when the whole video is too quiet. The peak ceiling still applies. |
| Peak ceiling | −6 dBFS | Move it left to reduce the loudest peaks. This controls digital audio level before the system volume and device output. |
| Bass recovery | +4 dB in Windows spatial modes | Adds bass below about 110 Hz before the peak limiter. Set it to 0 dB for a flat device comparison. |
| Equalizer | Flat | Adjust bass, presence, and treble to suit your headphones and the mix. |

**Clean** turns off boost and EQ, sets overall volume to 0 dB, and keeps a −3 dBFS peak ceiling. **Detail** lifts low-level effects as well as speech, **Dialogue** emphasizes the vocal range, **Night** reduces the difference between quiet and loud scenes, and **Cinema** keeps more punch. Playback mode and Bass recovery keep their selected values when you change presets. The other presets leave overall volume alone.

**Reset EQ** restores bass, presence, and treble to 0 dB. **Reset all settings** restores Balanced, Stereo, and the default slider values. Both buttons apply immediately if a tab is active.

The processing works on the full stereo mix, so soft music or background noise may also become more audible. A 5 ms lookahead limiter after the EQ, surround, and volume stages smooths peak reduction and applies the same gain to both stereo channels. The ceiling is measured on digital samples. Audio is processed locally in real time and is neither recorded nor uploaded.

## Headphones and Windows spatial sound

- **DTS Stereo** sends just the original front left and right channels to the Windows spatial renderer. Use the **Clean** preset to audition this route with neutral levels. The renderer name in the popup reflects the spatial format active in Windows.
- **7.1 PCM · Windows** preserves the stereo fronts and adds ambience to the sides and rear. The Windows companion leaves the generated center and subwoofer channels silent and reduces ambience when it detects strong shared content in the voice band. **Surround amount** adjusts the added ambience.
- **Headphone surround** uses Chrome's HRTF filters to simulate front speakers and place some stereo ambience to the sides and rear. Use **Surround amount** to blend it with the direct sound. This mode derives its cues from the stereo tab mix.
- **Stereo** sends the extension's processed stereo signal to the default audio output. Choose it when you want the leveler and EQ while leaving spatial effects to your Windows device.
- **Use original audio** preserves Chrome's normal playback path. For DTS Headphone:X, Windows Sonic, or Dolby Atmos for Headphones, choose the renderer on your headset under **Windows Settings → System → Sound → Spatial sound**. Whether Windows applies spatial processing depends on the playback device, application, and stream.

For DTS Headphone:X or Windows Sonic, select the renderer in Windows first. Choose **DTS Stereo** for two native spatial channels or **7.1 PCM · Windows** for eight, both at 48 kHz. The popup identifies the device and active renderer reported by Windows. If the companion is unavailable, Sound Booster uses Chrome's multichannel output for 7.1 when available and continues in Stereo otherwise. Re-enable the tab after changing the Windows device or renderer to reopen the stream.

To set up the Windows companion, run [Install-SpatialHost.ps1](windows/Install-SpatialHost.ps1) in PowerShell. It builds the host with Windows .NET Framework and registers it for the current Windows account. For a custom unpacked installation path, pass the extension's ID from `chrome://extensions` as `-ExtensionId`. Run the same script with `-Uninstall` to remove its registration. Chrome starts the companion only while the native output is needed. It uses the default Windows multimedia device and receives processed PCM locally over Chrome native messaging.

Choose one spatial renderer at a time. For the built-in headphone surround, turn off spatial processing in Windows on that headset. Chrome tab capture gives the extension a stereo mix. Its 7.1 output is derived from that mix, so it cannot preserve an original 5.1/7.1 channel bed or Atmos/DTS objects. [Windows setup](https://support.microsoft.com/en-us/windows/hardware/drivers/how-to-turn-on-spatial-sound-in-windows) · [Microsoft Spatial Sound](https://learn.microsoft.com/windows/win32/coreaudio/spatial-sound) · [DTS Sound Unbound](https://consumer.dts.com/dts-sound-unbound-faq/) · [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Verify the audio processor

Run `node --test tests/*.test.cjs` from the project folder. The tests exercise quiet lift, detail lift, transient limiting, stereo balance, and the 7.1 mix and its peak bounds.
