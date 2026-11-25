using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class SpatialOutput
{
    internal const int Channels = 8;
    internal const int SampleRate = 48000;
    private static readonly uint[] Speakers = { 2, 4, 8, 16, 128, 256, 32, 64 };
    private static readonly Guid EnumeratorClass = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid EnumeratorInterface = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
    private static readonly Guid ClientInterface = new Guid("BBF8E066-AAAA-49BE-9A4D-FD2A858EA27F");
    private static readonly Guid StreamInterface = new Guid("BAB5F473-B423-477B-85F5-B5A332A04153");

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct WaveFormat
    {
        internal ushort Tag, Channels;
        internal uint SampleRate, BytesPerSecond;
        internal ushort BlockAlign, Bits, ExtraSize;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct StreamParameters
    {
        internal IntPtr ObjectFormat;
        internal uint StaticMask, MinDynamic, MaxDynamic, Category;
        internal IntPtr EventHandle, Notify;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] internal ushort Type;
        [FieldOffset(8)] internal uint BlobSize;
        [FieldOffset(16)] internal IntPtr BlobData;
        [FieldOffset(8)] internal IntPtr StringValue;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        internal Guid Format;
        internal uint Id;
    }

    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint options);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("ole32.dll")] private static extern int CoCreateInstance(
        ref Guid clsid, IntPtr unknown, uint context, ref Guid iid, out IntPtr instance);
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropertyValue value);
    [DllImport("ole32.dll")] private static extern void CoTaskMemFree(IntPtr address);
    [DllImport("avrt.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr AvSetMmThreadCharacteristics(string name, out uint taskIndex);
    [DllImport("avrt.dll")] private static extern bool AvRevertMmThreadCharacteristics(IntPtr task);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint Release(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int Simple(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int DefaultEndpoint(
        IntPtr self, int flow, int role, out IntPtr endpoint);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int Activate(
        IntPtr self, ref Guid iid, uint context, IntPtr parameters, out IntPtr client);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int OpenProperties(
        IntPtr self, uint mode, out IntPtr store);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetDeviceId(IntPtr self, out IntPtr id);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetProperty(
        IntPtr self, ref PropertyKey key, out PropertyValue value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetUInt(IntPtr self, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int CheckObjectFormat(
        IntPtr self, ref WaveFormat format);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ActivateStream(
        IntPtr self, ref PropertyValue activation, ref Guid iid, out IntPtr stream);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int BeginUpdate(
        IntPtr self, out uint dynamics, out uint frames);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ActivateObject(
        IntPtr self, uint speaker, out IntPtr audioObject);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetBuffer(
        IntPtr self, out IntPtr buffer, out uint byteCount);

    private static T Method<T>(IntPtr instance, int slot) where T : class
    {
        IntPtr table = Marshal.ReadIntPtr(instance);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T));
    }

    private static void Free(IntPtr instance)
    {
        if (instance != IntPtr.Zero) Method<Release>(instance, 2)(instance);
    }

    private static void Check(int result, string action)
    {
        if (result < 0) throw new InvalidOperationException(action + " (0x" + result.ToString("X8") + ").");
    }

    private static string GetDeviceName(IntPtr device)
    {
        IntPtr store;
        if (Method<OpenProperties>(device, 4)(device, 0, out store) < 0) return "Default Windows output";
        try
        {
            var key = new PropertyKey { Format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), Id = 14 };
            PropertyValue value;
            if (Method<GetProperty>(store, 5)(store, ref key, out value) < 0) return "Default Windows output";
            try
            {
                return value.Type == 31 && value.StringValue != IntPtr.Zero
                    ? Marshal.PtrToStringUni(value.StringValue) : "Default Windows output";
            }
            finally { PropVariantClear(ref value); }
        }
        finally { Free(store); }
    }

    private static string GetRendererName(IntPtr device)
    {
        IntPtr id;
        if (Method<GetDeviceId>(device, 5)(device, out id) < 0) return null;
        try
        {
            const string assembly = ", Windows.Media, ContentType=WindowsRuntime";
            Type media = Type.GetType("Windows.Media.Devices.MediaDevice" + assembly, true);
            Type role = Type.GetType("Windows.Media.Devices.AudioDeviceRole" + assembly, true);
            Type configuration = Type.GetType("Windows.Media.Audio.SpatialAudioDeviceConfiguration" + assembly, true);
            Type subtypes = Type.GetType("Windows.Media.Audio.SpatialAudioFormatSubtype" + assembly, true);
            string winrtId = (string)media.GetMethod("GetDefaultAudioRenderId").Invoke(null, new[] { Enum.ToObject(role, 0) });
            if (String.IsNullOrEmpty(winrtId) || winrtId.IndexOf(Marshal.PtrToStringUni(id), StringComparison.OrdinalIgnoreCase) < 0)
                return null;
            object current = configuration.GetMethod("GetForDeviceId").Invoke(null, new object[] { winrtId });
            string active = (string)configuration.GetProperty("ActiveSpatialAudioFormat").GetValue(current, null);
            if (String.IsNullOrEmpty(active)) return null;
            string[,] names = {
                { "DTSHeadphoneX", "DTS Headphone:X" },
                { "DTSXUltra", "DTS:X Ultra" },
                { "DTSXForHomeTheater", "DTS:X for Home Theater" },
                { "WindowsSonic", "Windows Sonic" },
                { "DolbyAtmosForHeadphones", "Dolby Atmos for Headphones" },
                { "DolbyAtmosForHomeTheater", "Dolby Atmos for Home Theater" },
                { "DolbyAtmosForSpeakers", "Dolby Atmos for Speakers" }
            };
            for (int index = 0; index < names.GetLength(0); index++)
            {
                var property = subtypes.GetProperty(names[index, 0]);
                string format = property == null ? null : property.GetValue(null, null) as string;
                if (String.Equals(format, active, StringComparison.OrdinalIgnoreCase)) return names[index, 1];
            }
            return null;
        }
        catch (Exception)
        {
            // Renderer metadata is optional. The spatial audio stream still works.
            return null;
        }
        finally { CoTaskMemFree(id); }
    }

    private static IntPtr OpenStream(IntPtr client, IntPtr eventHandle, int outputChannels)
    {
        uint mask = outputChannels == 2 ? 0x06u : 0x1feu;
        uint supported;
        Check(Method<GetUInt>(client, 4)(client, out supported), "Reading the Windows spatial speaker layout failed");
        if ((supported & mask) != mask)
            throw new InvalidOperationException("The default Windows output does not expose the requested spatial speaker layout.");

        var format = new WaveFormat { Tag = 3, Channels = 1, SampleRate = SampleRate,
            BytesPerSecond = SampleRate * 4, BlockAlign = 4, Bits = 32 };
        Check(Method<CheckObjectFormat>(client, 8)(client, ref format), "The spatial renderer declined 48 kHz float audio");
        IntPtr wave = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveFormat)));
        IntPtr parameters = IntPtr.Zero;
        try
        {
            Marshal.StructureToPtr(format, wave, false);
            var settings = new StreamParameters { ObjectFormat = wave, StaticMask = mask, Category = 11, EventHandle = eventHandle };
            int size = Marshal.SizeOf(typeof(StreamParameters));
            parameters = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(settings, parameters, false);
            var activation = new PropertyValue { Type = 65, BlobSize = (uint)size, BlobData = parameters };
            Guid streamInterface = StreamInterface;
            IntPtr stream;
            Check(Method<ActivateStream>(client, 10)(client, ref activation, ref streamInterface, out stream),
                "Opening the Windows spatial stream failed");
            return stream;
        }
        finally
        {
            Marshal.FreeHGlobal(parameters);
            Marshal.FreeHGlobal(wave);
        }
    }

    internal static void Run(AudioQueue queue, StereoUpmixer upmixer, int inputChannels, int outputChannels, ManualResetEvent stop, Action<object> report)
    {
        IntPtr enumerator = IntPtr.Zero, device = IntPtr.Zero, client = IntPtr.Zero, stream = IntPtr.Zero;
        IntPtr task = IntPtr.Zero;
        var objects = new IntPtr[outputChannels];
        bool started = false;
        Check(CoInitializeEx(IntPtr.Zero, 0), "Initializing Windows audio failed");
        try
        {
            Guid clsid = EnumeratorClass, iid = EnumeratorInterface, clientInterface = ClientInterface;
            Check(CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out enumerator), "Opening Windows audio devices failed");
            Check(Method<DefaultEndpoint>(enumerator, 4)(enumerator, 0, 1, out device), "Finding the default Windows output failed");
            string deviceName = GetDeviceName(device);
            string rendererName = GetRendererName(device);
            Check(Method<Activate>(device, 3)(device, ref clientInterface, 1, IntPtr.Zero, out client),
                "Opening Windows Spatial Sound failed");
            using (var request = new AutoResetEvent(false))
            {
                stream = OpenStream(client, request.SafeWaitHandle.DangerousGetHandle(), outputChannels);
                BeginUpdate begin = Method<BeginUpdate>(stream, 8);
                Simple end = Method<Simple>(stream, 9);
                ActivateObject activate = Method<ActivateObject>(stream, 10);
                var getBuffers = new GetBuffer[outputChannels];
                var waits = new WaitHandle[] { stop, request };
                var frames = new float[8192 * outputChannels];
                var input = upmixer == null ? frames : new float[8192 * inputChannels];
                var plane = new float[8192];
                var clock = Stopwatch.StartNew();
                long nextReport = 1000;
                long rendered = 0;
                float peak = 0;
                uint taskIndex;
                task = AvSetMmThreadCharacteristics("Audio", out taskIndex);
                Check(Method<Simple>(stream, 5)(stream), "Starting the Windows spatial stream failed");
                started = true;
                try
                {
                    bool ready = false;
                    bool playing = false;
                    while (true)
                    {
                        int wait = WaitHandle.WaitAny(waits, 2000);
                        if (wait == 0) break;
                        if (wait == WaitHandle.WaitTimeout)
                            throw new InvalidOperationException("The Windows audio output stopped responding. Check the selected device.");
                        uint dynamicCount, frameCount;
                        Check(begin(stream, out dynamicCount, out frameCount), "Reading the Windows spatial buffer failed");
                        try
                        {
                            if (frameCount > plane.Length) throw new InvalidOperationException("Windows returned an unexpectedly large audio buffer.");
                            int count = (int)frameCount;
                            if (count == 0) continue;
                            rendered += queue.Read(input, count);
                            if (upmixer != null) upmixer.Render(input, frames, count);
                            for (int channel = 0; channel < outputChannels; channel++)
                            {
                                if (objects[channel] == IntPtr.Zero)
                                {
                                    Check(activate(stream, Speakers[channel], out objects[channel]), "Opening a Windows spatial speaker failed");
                                    getBuffers[channel] = Method<GetBuffer>(objects[channel], 3);
                                }
                                IntPtr target;
                                uint bytes;
                                Check(getBuffers[channel](objects[channel], out target, out bytes), "Opening a spatial speaker buffer failed");
                                if (bytes != frameCount * 4) throw new InvalidOperationException("Windows returned an invalid speaker buffer size.");
                                for (int frame = 0; frame < count; frame++)
                                {
                                    float sample = frames[frame * outputChannels + channel];
                                    plane[frame] = sample;
                                    peak = Math.Max(peak, Math.Abs(sample));
                                }
                                Marshal.Copy(plane, 0, target, count);
                            }
                        }
                        finally { Check(end(stream), "Submitting the Windows spatial buffer failed"); }
                        if (!ready)
                        {
                            report(new { type = "ready", channels = outputChannels, sampleRate = SampleRate,
                                device = deviceName, renderer = rendererName, inputChannels = inputChannels });
                            ready = true;
                        }
                        if (!playing && rendered > 0)
                        {
                            report(new { type = "playing" });
                            playing = true;
                        }
                        if (clock.ElapsedMilliseconds >= nextReport)
                        {
                            report(new { type = "stats", renderedFrames = rendered, peak = peak, bufferedFrames = queue.BufferedFrames,
                                droppedFrames = queue.DroppedFrames, underruns = queue.Underruns });
                            peak = 0;
                            nextReport = clock.ElapsedMilliseconds + 1000;
                        }
                    }
                }
                finally
                {
                    if (started) Method<Simple>(stream, 6)(stream);
                    foreach (IntPtr audioObject in objects) Free(audioObject);
                    Free(stream);
                    stream = IntPtr.Zero;
                }
            }
        }
        finally
        {
            if (task != IntPtr.Zero) AvRevertMmThreadCharacteristics(task);
            Free(stream);
            Free(client);
            Free(device);
            Free(enumerator);
            CoUninitialize();
        }
    }
}
