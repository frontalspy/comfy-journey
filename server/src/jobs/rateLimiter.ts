/** Sliding-window limiter per owner. In memory: it resets on restart, which is acceptable here. */
export class OwnerRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true, or returns false (recording nothing) when over the limit. */
  tryHit(ownerId: string): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.hits.get(ownerId) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.maxHits) {
      this.hits.set(ownerId, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(ownerId, recent);
    return true;
  }
}
