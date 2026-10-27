export function untested(x: number): string {
  if (x > 0) return "pos";
  if (x < 0) return "neg";
  return "zero";
}
