const MIN_COLUMN_PX = 210;
const MAX_COLUMNS = 8;

/** Column count that follows the container's width: two on a phone, up to eight on a wide screen. */
export function columnsForWidth(widthPx: number): number {
  return Math.min(MAX_COLUMNS, Math.max(2, Math.floor(widthPx / MIN_COLUMN_PX)));
}

/**
 * Deals items, in order, into the currently shortest column. Appending items never moves the
 * ones already placed, so infinite scroll does not shuffle what is on screen.
 * `ratioOf` is width / height.
 */
export function distribute<T>(
  items: readonly T[],
  columns: number,
  ratioOf: (item: T) => number,
): T[][] {
  const lanes: T[][] = Array.from({ length: columns }, () => []);
  const heights: number[] = Array.from({ length: columns }, () => 0);
  for (const item of items) {
    let shortest = 0;
    for (let lane = 1; lane < columns; lane++) {
      if ((heights[lane] ?? 0) < (heights[shortest] ?? 0)) shortest = lane;
    }
    lanes[shortest]?.push(item);
    heights[shortest] = (heights[shortest] ?? 0) + 1 / Math.max(0.2, ratioOf(item));
  }
  return lanes;
}
