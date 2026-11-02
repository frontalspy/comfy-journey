import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleRecurring } from "./scheduler.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("scheduleRecurring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs on every interval, not immediately", () => {
    const task = vi.fn();
    const stop = scheduleRecurring(1000, task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
  });

  it("handles intervals beyond setTimeout's 32-bit ceiling without firing early", () => {
    const task = vi.fn();
    const stop = scheduleRecurring(30 * DAY_MS, task);
    vi.advanceTimersByTime(25 * DAY_MS);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * DAY_MS);
    expect(task).toHaveBeenCalledOnce();
    stop();
  });

  it("stops when asked", () => {
    const task = vi.fn();
    const stop = scheduleRecurring(1000, task);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledOnce();
  });
});
