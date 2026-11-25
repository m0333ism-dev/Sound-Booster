export const presets = Object.freeze({
  clean: { volumeDb: 0, boostDb: 0, detailDb: 0, ceilingDb: -3, bassDb: 0, presenceDb: 0, trebleDb: 0 },
  balanced: { boostDb: 9, detailDb: 0, ceilingDb: -6, bassDb: 0, presenceDb: 0, trebleDb: 0 },
  detail: { boostDb: 8, detailDb: 7, ceilingDb: -8, bassDb: 0, presenceDb: 1, trebleDb: 0 },
  dialogue: { boostDb: 13, detailDb: 2, ceilingDb: -8, bassDb: -2, presenceDb: 3, trebleDb: 0 },
  night: { boostDb: 14, detailDb: 5, ceilingDb: -15, bassDb: -5, presenceDb: 2, trebleDb: -1 },
  cinema: { boostDb: 6, detailDb: 3, ceilingDb: -4, bassDb: 3, presenceDb: 1, trebleDb: 1 }
});

export const defaultSettings = Object.freeze({
  ...presets.balanced,
  volumeDb: 0,
  bassRecoveryDb: 4,
  outputMode: "stereo",
  surround: 65
});

export function normalizeSettings(settings) {
  settings ??= {};
  const outputMode = ["stereo", "surround", "pcm71", "dtsStereo"].includes(settings.outputMode)
    ? settings.outputMode : defaultSettings.outputMode;
  return {
    volumeDb: level(settings.volumeDb, 0, 24, defaultSettings.volumeDb),
    boostDb: level(settings.boostDb, 0, 18, defaultSettings.boostDb),
    detailDb: level(settings.detailDb, 0, 12, defaultSettings.detailDb),
    ceilingDb: level(settings.ceilingDb, -24, -1, defaultSettings.ceilingDb),
    bassDb: level(settings.bassDb, -9, 9, defaultSettings.bassDb),
    presenceDb: level(settings.presenceDb, -6, 6, defaultSettings.presenceDb),
    trebleDb: level(settings.trebleDb, -9, 9, defaultSettings.trebleDb),
    bassRecoveryDb: level(settings.bassRecoveryDb, 0, 8, defaultSettings.bassRecoveryDb),
    outputMode,
    surround: level(settings.surround, 0, 100, defaultSettings.surround)
  };
}

export function isWindowsSpatial(outputMode) {
  return outputMode === "pcm71" || outputMode === "dtsStereo";
}

function level(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}
