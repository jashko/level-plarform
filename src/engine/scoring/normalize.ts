/**
 * Утилиты нормализации. Используются всеми скоринговыми модулями.
 */

/** Линейная min-max нормализация в 0–100. */
export function normalizeMinMax(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Обратная min-max нормализация (меньше = лучше). */
export function normalizeMinMaxInverse(value: number, min: number, max: number): number {
  return 100 - normalizeMinMax(value, min, max);
}

/** Кусочно-линейная нормализация по якорным точкам, отсортированным по x. */
export function normalizePiecewise(
  value: number,
  anchors: Array<[number, number]>, // [(x, score)...]
): number {
  if (anchors.length === 0) return 50;
  if (value <= anchors[0]![0]) return anchors[0]![1];
  if (value >= anchors[anchors.length - 1]![0]) return anchors[anchors.length - 1]![1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x1, y1] = anchors[i]!;
    const [x2, y2] = anchors[i + 1]!;
    if (value >= x1 && value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return 50;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
