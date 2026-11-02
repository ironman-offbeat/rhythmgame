import {
  GEOMETRY,
  noteProgress,
  type GameConfig,
  type GameSnapshot,
  type JudgeEvent,
} from './engine';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const TWO_PI = Math.PI * 2;

function circle(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
}

export function drawGame(
  canvas: HTMLCanvasElement,
  view: GameSnapshot,
  config: GameConfig,
  feedback: JudgeEvent | null,
): void {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(Math.min(width / 556, height / 580, 1.18), Math.min(width / 556, height / 580, 1.18));

  // Background reticle and subtle radar-like guide rings.
  const halo = ctx.createRadialGradient(0, 0, 45, 0, 0, 300);
  halo.addColorStop(0, 'rgba(21, 54, 76, 0.35)');
  halo.addColorStop(0.62, 'rgba(10, 38, 63, 0.13)');
  halo.addColorStop(1, 'rgba(8, 19, 36, 0)');
  ctx.fillStyle = halo;
  circle(ctx, 300);
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(109, 168, 192, 0.09)';
  for (const radius of [67, 104, 201, 254]) {
    circle(ctx, radius);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-270, 0);
  ctx.lineTo(270, 0);
  ctx.moveTo(0, -270);
  ctx.lineTo(0, 270);
  ctx.strokeStyle = 'rgba(101, 166, 192, 0.055)';
  ctx.stroke();

  // Notes are drawn first so the fixed dashed target always stays on top.
  for (const note of view.notes) {
    const progress = noteProgress(note, view.elapsed, config);
    if (view.elapsed < note.spawnAt || progress >= 1) continue;
    const radius = GEOMETRY.startRadius + (GEOMETRY.endRadius - GEOMETRY.startRadius) * progress;
    const visibility = clamp(progress / 0.11) * clamp((1 - progress) / 0.2);
    const glow = note.status === 'good' ? '137, 255, 196' : '211, 89, 255';
    ctx.save();
    ctx.globalAlpha = visibility;
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    fill.addColorStop(0, 'rgba(147, 64, 225, 0.035)');
    fill.addColorStop(0.65, 'rgba(188, 68, 250, 0.065)');
    fill.addColorStop(1, `rgba(${glow}, 0.13)`);
    circle(ctx, radius);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineWidth = 2.6;
    ctx.strokeStyle = `rgba(${glow}, 0.95)`;
    ctx.shadowColor = `rgba(${glow}, 0.85)`;
    ctx.shadowBlur = 23;
    circle(ctx, radius);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${glow}, 0.28)`;
    circle(ctx, radius + 5);
    ctx.stroke();
    ctx.restore();
  }

  // The visible stroke and timing logic use exactly the same width.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = config.bandWidth;
  ctx.setLineDash([6, 11]);
  ctx.shadowColor = view.holding ? '#9cffc0' : '#43eaff';
  ctx.shadowBlur = view.holding ? 24 : 15;
  ctx.strokeStyle = view.holding ? '#8effba' : '#62e8f5';
  circle(ctx, GEOMETRY.targetRadius);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(93, 232, 241, 0.14)';
  circle(ctx, GEOMETRY.targetRadius + config.bandWidth / 2 + 8);
  ctx.stroke();
  circle(ctx, GEOMETRY.targetRadius - config.bandWidth / 2 - 8);
  ctx.stroke();
  ctx.restore();

  // A modest center marker makes a held input visually obvious.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 15px "Malgun Gothic", sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillStyle = view.holding ? '#98ffc4' : '#95b8c9';
  ctx.fillText(view.holding ? 'HOLD' : 'PRESS & RELEASE', 0, 0);
  ctx.font = '400 11px "Malgun Gothic", sans-serif';
  ctx.letterSpacing = '0.4px';
  ctx.fillStyle = '#6e8da2';
  ctx.fillText(view.holding ? '구간이 끝나기 전에 떼세요' : '원 테두리가 점선에 진입하면 누르세요', 0, 25);
  ctx.restore();

  if (feedback && view.elapsed >= feedback.at) {
    const age = view.elapsed - feedback.at;
    if (age < 980) {
      const fade = clamp((980 - age) / 350) * clamp(age / 90);
      const lift = Math.min(age / 16, 26);
      const good = feedback.kind === 'GOOD';
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = fade;
      ctx.font = '800 34px "Malgun Gothic", sans-serif';
      ctx.letterSpacing = '4px';
      ctx.fillStyle = good ? '#8effc0' : '#ff6ca5';
      ctx.shadowColor = good ? '#24f89c' : '#ff427c';
      ctx.shadowBlur = 18;
      ctx.fillText(good ? 'GOOD  +1' : 'BAD', 0, -213 - lift);
      ctx.shadowBlur = 0;
      const ringAlpha = clamp((600 - age) / 600);
      ctx.globalAlpha = ringAlpha * 0.5;
      ctx.lineWidth = 3;
      ctx.strokeStyle = good ? '#91ffbd' : '#ff6ca5';
      circle(ctx, GEOMETRY.targetRadius + 26 + age / 28);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}
