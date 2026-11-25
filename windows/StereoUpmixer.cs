using System;

internal sealed class StereoUpmixer
{
    private readonly float energySmoothing = TimeConstant(0.027);
    private readonly float amountSmoothing = TimeConstant(0.035);
    private readonly float transientAttack = TimeConstant(0.004);
    private readonly float transientReference = TimeConstant(0.078);
    private readonly float surroundAttack = TimeConstant(0.006);
    private readonly float surroundRelease = TimeConstant(0.090);
    private readonly float lowCut = Cutoff(280);
    private readonly float highCut = Cutoff(4200);
    private readonly Decorrelator sideLeft = new Decorrelator(0.0029, 0.31f);
    private readonly Decorrelator sideRight = new Decorrelator(0.0041, -0.28f);
    private readonly Decorrelator backLeft = new Decorrelator(0.0061, -0.32f);
    private readonly Decorrelator backRight = new Decorrelator(0.0083, 0.29f);

    private float midEnergy, sideEnergy, leftEnergy, rightEnergy;
    private float slowSide, fastSide, lowSide, bandSide, lowMid, bandMid;
    private float ambienceGain;
    private float amount;
    private volatile int targetAmount;

    internal StereoUpmixer(int surround)
    {
        SetSurround(surround);
        amount = targetAmount * 0.01f;
    }

    internal void SetSurround(int surround)
    {
        targetAmount = Math.Max(0, Math.Min(100, surround));
    }

    private static float TimeConstant(double seconds)
    {
        return (float)(1 - Math.Exp(-1 / (SpatialOutput.SampleRate * seconds)));
    }

    private static float Cutoff(double frequency)
    {
        return (float)(1 - Math.Exp(-2 * Math.PI * frequency / SpatialOutput.SampleRate));
    }

    private static float Unit(float value)
    {
        return Math.Max(0, Math.Min(1, value));
    }

    internal void Render(float[] stereo, float[] output, int frames)
    {
        float target = targetAmount * 0.01f;
        for (int frame = 0, offset = 0; frame < frames; frame++, offset += SpatialOutput.Channels)
        {
            float left = stereo[2 * frame], right = stereo[2 * frame + 1];
            float mid = (left + right) * 0.5f, side = (left - right) * 0.5f;
            lowMid += (mid - lowMid) * lowCut;
            lowSide += (side - lowSide) * lowCut;
            bandMid += ((mid - lowMid) * 0.5f - bandMid) * highCut;
            bandSide += ((side - lowSide) * 0.5f - bandSide) * highCut;
            float power = bandSide * bandSide;
            midEnergy += (bandMid * bandMid - midEnergy) * energySmoothing;
            sideEnergy += (power - sideEnergy) * energySmoothing;
            leftEnergy += (left * left - leftEnergy) * energySmoothing;
            rightEnergy += (right * right - rightEnergy) * energySmoothing;
            float correlation = (midEnergy - sideEnergy) / (midEnergy + sideEnergy + 1e-10f);
            float balance = 2 * Math.Min(leftEnergy, rightEnergy) / (leftEnergy + rightEnergy + 1e-10f);
            amount += (target - amount) * amountSmoothing;

            // Keep the original stereo image. A copy in the center creates a second
            // spatial rendering of the same voice, so the generated center stays silent.
            output[offset] = left;
            output[offset + 1] = right;
            output[offset + 2] = 0;
            output[offset + 3] = 0;

            // Derive a bounded ambience band. Narrow or short, sharp effects stay mostly in front.
            fastSide += (power - fastSide) * transientAttack;
            slowSide += (power - slowSide) * transientReference;
            float transient = Unit((fastSide / (slowSide + 2e-8f) - 1.35f) / 2.8f);
            float coherentFront = Unit((correlation - 0.05f) / 0.75f);
            float desired = (0.18f + 0.82f * balance) * (1f - 0.65f * transient) * (1f - 0.87f * coherentFront);
            ambienceGain += (desired - ambienceGain) * (desired < ambienceGain ? surroundAttack : surroundRelease);
            float surround = amount * ambienceGain;
            output[offset + 4] = backLeft.Process(bandSide) * (surround * 0.30f);
            output[offset + 5] = backRight.Process(-bandSide) * (surround * 0.30f);
            output[offset + 6] = sideLeft.Process(bandSide) * (surround * 0.63f);
            output[offset + 7] = sideRight.Process(-bandSide) * (surround * 0.63f);
        }
    }

    private sealed class Decorrelator
    {
        private readonly float[] delay;
        private readonly float feedback, peakScale;
        private int index;

        internal Decorrelator(double seconds, float coefficient)
        {
            delay = new float[(int)Math.Round(seconds * SpatialOutput.SampleRate)];
            feedback = coefficient;
            peakScale = 1 / (1 + 2 * Math.Abs(feedback));
        }

        internal float Process(float input)
        {
            float output = delay[index] - feedback * input;
            delay[index] = input + feedback * output;
            if (++index == delay.Length) index = 0;
            // The impulse response's absolute sum is 1 + 2|feedback|.
            return output * peakScale;
        }
    }
}
