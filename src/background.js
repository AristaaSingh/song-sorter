let peakColor = { r: 45, g: 255, b: 130 };

export function getPeakColor() { return peakColor; }

export function extractDominantColor(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 50; canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 50, 50);
    const data = ctx.getImageData(0, 0, 50, 50).data;

    let bestR = 0, bestG = 0, bestB = 0, bestScore = -1;
    for (let i = 0; i < data.length; i += 12) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const brightness = (r + g + b) / 3;
      if (brightness < 25 || brightness > 230) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation > bestScore) {
        bestScore = saturation; bestR = r; bestG = g; bestB = b;
      }
    }
    return bestScore >= 0 ? { r: bestR, g: bestG, b: bestB } : null;
  } catch { return null; }
}

export function applyBackground(color) {
  const tabEls = [
    document.getElementById('cell-create-inner'),
    document.getElementById('cell-playlists-inner'),
    document.getElementById('cell-tracker'),
  ];

  if (!color) {
    document.body.style.background = '#0a0a0a';
    document.body.classList.remove('theme-light');
    tabEls.forEach(el => { el.style.background = 'rgba(0,0,0,0.45)'; });
    return;
  }

  const { r, g, b } = color;
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const clamp = v => Math.min(255, v);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const bright = luminance > 0.55;
  document.body.classList.toggle('theme-light', bright);

  let bgGrad, tabGrad;

  if (bright) {
    const lf = 248;
    const floor = [lerp(r, lf, 0.82), lerp(g, lf, 0.82), lerp(b, lf, 0.82)];
    const mid   = [lerp(r, lf, 0.45), lerp(g, lf, 0.45), lerp(b, lf, 0.45)];
    const lo    = [lerp(r, lf, 0.65), lerp(g, lf, 0.65), lerp(b, lf, 0.65)];
    const peak  = [clamp(Math.round(r * 1.2)), clamp(Math.round(g * 1.2)), clamp(Math.round(b * 1.2))];
    peakColor = { r: peak[0], g: peak[1], b: peak[2] };
    bgGrad = `radial-gradient(ellipse 160% 65% at 50% 0%,
      rgb(${peak}) 0%,
      rgb(${r},${g},${b}) 18%,
      rgb(${mid}) 45%,
      rgb(${lo}) 68%,
      rgb(${floor}) 100%)`;
    const tt  = [lerp(r, lf, 0.55), lerp(g, lf, 0.55), lerp(b, lf, 0.55)];
    const ttm = [lerp(r, lf, 0.72), lerp(g, lf, 0.72), lerp(b, lf, 0.72)];
    const ttd = [lerp(r, lf, 0.88), lerp(g, lf, 0.88), lerp(b, lf, 0.88)];
    const ttp = [clamp(Math.round(tt[0] * 1.1)), clamp(Math.round(tt[1] * 1.1)), clamp(Math.round(tt[2] * 1.1))];
    tabGrad = `linear-gradient(160deg,
      rgb(${ttp}) 0%,
      rgb(${tt}) 18%,
      rgb(${ttm}) 55%,
      rgb(${ttd}) 100%)`;
  } else {
    const fr = 8, fg = 6, fb = 8;
    const dr  = lerp(r, fr, 0.93), dg  = lerp(g, fg, 0.93), db  = lerp(b, fb, 0.93);
    const mr  = lerp(r, fr, 0.55), mg  = lerp(g, fg, 0.55), mb  = lerp(b, fb, 0.55);
    const lr2 = lerp(r, fr, 0.78), lg2 = lerp(g, fg, 0.78), lb2 = lerp(b, fb, 0.78);
    const br2 = clamp(Math.round(r * 1.55)), bg2 = clamp(Math.round(g * 1.55)), bb2 = clamp(Math.round(b * 1.55));
    peakColor = { r: br2, g: bg2, b: bb2 };
    bgGrad = `radial-gradient(ellipse 160% 65% at 50% 0%,
      rgb(${br2},${bg2},${bb2}) 0%,
      rgb(${r},${g},${b}) 18%,
      rgb(${mr},${mg},${mb}) 45%,
      rgb(${lr2},${lg2},${lb2}) 68%,
      rgb(${dr},${dg},${db}) 100%)`;
    const tr2 = lerp(r, fr, 0.30), tg2 = lerp(g, fg, 0.30), tb2 = lerp(b, fb, 0.30);
    const tmr = lerp(r, fr, 0.62), tmg = lerp(g, fg, 0.62), tmb = lerp(b, fb, 0.62);
    const tdr = lerp(r, fr, 0.88), tdg = lerp(g, fg, 0.88), tdb = lerp(b, fb, 0.88);
    const tbr = clamp(Math.round(tr2 * 1.55)), tbg = clamp(Math.round(tg2 * 1.55)), tbb = clamp(Math.round(tb2 * 1.55));
    tabGrad = `linear-gradient(160deg,
      rgb(${tbr},${tbg},${tbb}) 0%,
      rgb(${tr2},${tg2},${tb2}) 18%,
      rgb(${tmr},${tmg},${tmb}) 55%,
      rgb(${tdr},${tdg},${tdb}) 100%)`;
  }

  document.body.style.background = bgGrad;
  tabEls.forEach(el => { el.style.background = tabGrad; });
}
