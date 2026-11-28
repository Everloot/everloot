/**
 * A chart axis's step for a 0 / step / 2 × step axis: a round, whole number at or above half the top value, so the
 * half-way label reads 1,500 or 15,000, never 1,947.5 or 13,575.
 */
export function axisStep(max: number): number {
  const half = Math.max(1, max) / 2;
  const power = 10 ** Math.floor(Math.log10(half));
  return Math.max(1, [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * power).find((step) => step >= half && Number.isInteger(step))!);
}

/**
 * The same step for a share axis (0 to 1), in whole percents: 15% at the top gives 0 / 8% / 16%, so each label is the
 * value its gridline is drawn at, never 7.5% labelled "8%".
 */
export const percentAxisStep = (maxShare: number): number => axisStep(maxShare * 100) / 100;
