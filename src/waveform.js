import { initAudio, getOnsetStrength } from './audioAnalyser.js';
import { getPeakColor, isLightTheme } from './background.js';

let waveAnimId = null;
let peakHeight = 0;
let ripples = [];

export async function initWaveform() {
  const canvas = document.getElementById('waveform');
  const wrap = document.getElementById('waveform-wrap');
  canvas.width = wrap.clientWidth || 260;
  canvas.height = 116;
  await initAudio();
  drawWaveframe();
}

export function stopWaveform() {
  if (waveAnimId) { cancelAnimationFrame(waveAnimId); waveAnimId = null; }
}

function drawWaveframe() {
  const canvas = document.getElementById('waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const { r: pr, g: pg, b: pb } = getPeakColor();

  const onset = getOnsetStrength() ?? 0;
  const THRESHOLD = 0.07;
  const gated = Math.max(0, onset - THRESHOLD);
  const target = Math.min(1, (gated * 16) ** 1.5);
  peakHeight += (target - peakHeight) * (target > peakHeight ? 1.0 : 0.18);

  if (gated * 18 > 0.5) {
    ripples.push({ spread: 6, amplitude: peakHeight, opacity: 0.7 });
  }

  ripples = ripples.filter(r => r.opacity > 0.01);
  for (const r of ripples) {
    r.spread += 2.2;
    r.amplitude *= 0.88;
    r.opacity *= 0.84;
  }

  const maxSpike = (H / 2) * 0.92;
  const cy = H / 2;

  function drawSpike(spikePx, sharpness, alpha, lineWidth, blur) {
    const s = spikePx * maxSpike;

    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const t = (x / W) * 2 - 1;
      ctx.lineTo(x, cy - s * Math.exp(-t * t * sharpness));
    }
    for (let x = W; x >= 0; x--) {
      const t = (x / W) * 2 - 1;
      ctx.lineTo(x, cy + s * Math.exp(-t * t * sharpness));
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, cy - s, 0, cy + s);
    grad.addColorStop(0,   `rgba(${pr},${pg},${pb},${alpha * 0.85})`);
    grad.addColorStop(0.4, `rgba(${pr},${pg},${pb},${alpha * 0.35})`);
    grad.addColorStop(1,   `rgba(${pr},${pg},${pb},0)`);
    ctx.fillStyle = grad;
    ctx.fill();

    const edgePts = [];
    for (let x = 0; x <= W; x++) {
      const t = (x / W) * 2 - 1;
      edgePts.push(cy - s * Math.exp(-t * t * sharpness));
    }
    function traceLine() {
      ctx.beginPath();
      for (let x = 0; x <= W; x++) ctx.lineTo(x, edgePts[x]);
    }

    const light = isLightTheme();

    // soft glow hug — stays close to the line
    traceLine();
    ctx.shadowColor = `rgba(${pr},${pg},${pb},${alpha})`;
    ctx.shadowBlur = blur * (light ? 1.2 : 2);
    ctx.strokeStyle = `rgba(${pr},${pg},${pb},${alpha * (light ? 0.4 : 0.55)})`;
    ctx.lineWidth = lineWidth * 2.5;
    ctx.stroke();

    // core line
    traceLine();
    ctx.shadowBlur = blur * (light ? 0.4 : 0.8);
    ctx.strokeStyle = `rgba(${pr},${pg},${pb},${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // centre highlight
    traceLine();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = light
      ? `rgba(0,0,0,${alpha * 0.3})`
      : `rgba(255,255,255,${alpha * 0.7})`;
    ctx.lineWidth = lineWidth * 0.4;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  for (const r of ripples) {
    const sharpness = Math.max(0.3, 6 / (r.spread * 0.5));
    drawSpike(r.amplitude, sharpness, r.opacity * 0.6, 1, 6);
  }

  drawSpike(peakHeight, 6, 1.0, 1.5, 14);

  waveAnimId = requestAnimationFrame(drawWaveframe);
}
