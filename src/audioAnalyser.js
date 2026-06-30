let analyser = null;
let freqData = null;

export async function initAudio() {
  try {
    const sources = await window.spotify.getDesktopSources();
    if (!sources?.length) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      },
    });

    stream.getVideoTracks().forEach(t => t.stop());

    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch (e) {
    console.warn('Audio capture unavailable:', e.message);
  }
}

let prevBassEnergy = 0;

export function getOnsetStrength() {
  if (!analyser || !freqData) return null;
  analyser.getByteFrequencyData(freqData);

  // bass band: bins 0–6 (~0–300 Hz) — where kicks live
  let bassSum = 0;
  const bassEnd = Math.min(6, freqData.length);
  for (let i = 0; i < bassEnd; i++) bassSum += freqData[i];
  const bassEnergy = bassSum / (bassEnd * 255);

  // onset = positive energy jump from previous frame
  const onset = Math.max(0, bassEnergy - prevBassEnergy);
  prevBassEnergy = bassEnergy;

  return onset;
}
