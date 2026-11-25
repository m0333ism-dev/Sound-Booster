using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class AudioQueue
{
    private const int Capacity = 4096;
    private const int Prefill = 2048;
    private const int FadeFrames = 64;
    private readonly int channels;
    private readonly float[] buffer;
    private readonly object gate = new object();
    private int start, end, count;
    private bool playing;
    private long dropped, underruns;

    internal AudioQueue(int channels)
    {
        this.channels = channels;
        buffer = new float[Capacity * channels];
    }

    internal int BufferedFrames { get { lock (gate) return count; } }
    internal long DroppedFrames { get { lock (gate) return dropped; } }
    internal long Underruns { get { lock (gate) return underruns; } }

    internal void Write(byte[] samples)
    {
        int bytesPerFrame = channels * sizeof(float);
        int frames = samples.Length / bytesPerFrame;
        if (frames == 0 || frames > 2048 || samples.Length % bytesPerFrame != 0)
            throw new InvalidDataException("Invalid PCM packet size.");
        lock (gate)
        {
            int skip = Math.Max(0, count + frames - Capacity);
            dropped += skip;
            start = (start + skip) % Capacity;
            count -= skip;
            int first = Math.Min(frames, Capacity - end);
            Buffer.BlockCopy(samples, 0, buffer, end * bytesPerFrame, first * bytesPerFrame);
            Buffer.BlockCopy(samples, first * bytesPerFrame, buffer, 0, (frames - first) * bytesPerFrame);
            end = (end + frames) % Capacity;
            count += frames;
        }
    }

    internal int Read(float[] destination, int frames)
    {
        int consumed;
        bool fadeIn, fadeOut;
        lock (gate)
        {
            fadeIn = !playing && count >= Prefill;
            if (fadeIn) playing = true;
            consumed = playing ? Math.Min(count, frames) : 0;
            int first = Math.Min(consumed, Capacity - start);
            Array.Copy(buffer, start * channels, destination, 0, first * channels);
            Array.Copy(buffer, 0, destination, first * channels, (consumed - first) * channels);
            start = (start + consumed) % Capacity;
            count -= consumed;
            fadeOut = playing && consumed < frames;
            if (fadeOut)
            {
                underruns++;
                playing = false;
            }
        }
        if (fadeIn || fadeOut)
        {
            int fade = Math.Min(consumed, FadeFrames);
            for (int frame = 0; frame < fade; frame++)
            {
                float gain = (float)frame / fade;
                for (int channel = 0; channel < channels; channel++)
                {
                    if (fadeIn) destination[frame * channels + channel] *= gain;
                    if (fadeOut) destination[(consumed - 1 - frame) * channels + channel] *= gain;
                }
            }
        }
        Array.Clear(destination, consumed * channels, (frames - consumed) * channels);
        return consumed;
    }
}

internal static class Program
{
    private static readonly object OutputGate = new object();
    private static readonly JavaScriptSerializer Decoder = new JavaScriptSerializer();
    private static readonly JavaScriptSerializer Encoder = new JavaScriptSerializer();
    private static Stream output;

    private static bool ReadExactly(Stream stream, byte[] bytes, bool allowEof)
    {
        int offset = 0;
        while (offset < bytes.Length)
        {
            int read = stream.Read(bytes, offset, bytes.Length - offset);
            if (read == 0)
            {
                if (allowEof && offset == 0) return false;
                throw new EndOfStreamException("Chrome closed the PCM stream.");
            }
            offset += read;
        }
        return true;
    }

    private static Dictionary<string, object> ReadMessage(Stream input)
    {
        var header = new byte[4];
        if (!ReadExactly(input, header, true)) return null;
        int length = BitConverter.ToInt32(header, 0);
        if (length < 1 || length > 100000) throw new InvalidDataException("Invalid Chrome native message size.");
        var body = new byte[length];
        ReadExactly(input, body, false);
        return Decoder.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
    }

    private static void Send(object value)
    {
        lock (OutputGate)
        {
            byte[] body = Encoding.UTF8.GetBytes(Encoder.Serialize(value));
            byte[] header = BitConverter.GetBytes(body.Length);
            output.Write(header, 0, header.Length);
            output.Write(body, 0, body.Length);
            output.Flush();
        }
    }

    private static void ReportFailure(Exception error)
    {
        try { Send(new { type = "error", message = error.Message }); }
        catch (IOException) { }
    }

    private static int Main()
    {
        using (Stream input = Console.OpenStandardInput())
        using (output = Console.OpenStandardOutput())
        using (var stop = new ManualResetEvent(false))
        {
            Thread renderer = null;
            try
            {
                Dictionary<string, object> request = ReadMessage(input);
                if (request == null) return 0;
                int protocol = (int)request["version"];
                int channels = (int)request["channels"];
                bool nativeMix = protocol == 2 && channels == 2;
                bool legacyPcm = protocol == 1 && channels == SpatialOutput.Channels;
                if ((string)request["type"] != "start" || !(nativeMix || legacyPcm)
                    || (int)request["sampleRate"] != SpatialOutput.SampleRate)
                    throw new InvalidDataException("Chrome requested an unsupported spatial audio protocol.");
                var queue = new AudioQueue(channels);
                object stereoOnly;
                bool frontsOnly = nativeMix && request.TryGetValue("stereoOnly", out stereoOnly) && stereoOnly is bool && (bool)stereoOnly;
                int outputChannels = frontsOnly ? 2 : SpatialOutput.Channels;
                var upmixer = nativeMix && !frontsOnly ? new StereoUpmixer((int)request["surround"]) : null;
                renderer = new Thread(delegate()
                {
                    try { SpatialOutput.Run(queue, upmixer, channels, outputChannels, stop, Send); }
                    catch (Exception error) { ReportFailure(error); }
                });
                renderer.IsBackground = true;
                renderer.Start();
                while ((request = ReadMessage(input)) != null)
                {
                    string type = (string)request["type"];
                    if (type == "stop") break;
                    if (type == "audio") queue.Write(Convert.FromBase64String((string)request["data"]));
                    else if (type == "mix" && upmixer != null) upmixer.SetSurround((int)request["surround"]);
                    else throw new InvalidDataException("Unexpected Chrome audio message.");
                }
                return 0;
            }
            catch (Exception error)
            {
                ReportFailure(error);
                return 1;
            }
            finally
            {
                stop.Set();
                if (renderer != null) renderer.Join(2000);
            }
        }
    }
}
