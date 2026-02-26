import { describe, expect, it } from "vitest";
import { evaluateRunawayGuard } from "../runawayGuard";

describe("evaluateRunawayGuard", () => {
  it("does not record durations before iteration 5", () => {
    const result = evaluateRunawayGuard({
      iteration: 4,
      lastIterationAt: "2026-02-26T12:00:00.000Z",
      previousDurations: [10, 12],
      now: new Date("2026-02-26T12:00:20.000Z"),
    });

    expect(result).toEqual({
      durations: [10, 12],
      averageSeconds: null,
      shouldStop: false,
    });
  });

  it("stops when average of last 3 durations is <= 15 seconds", () => {
    const result = evaluateRunawayGuard({
      iteration: 6,
      lastIterationAt: "2026-02-26T12:00:00.000Z",
      previousDurations: [8, 12],
      now: new Date("2026-02-26T12:00:10.000Z"),
    });

    expect(result).toEqual({
      durations: [8, 12, 10],
      averageSeconds: 10,
      shouldStop: true,
    });
  });

  it("keeps only last 3 durations and continues when average is above threshold", () => {
    const result = evaluateRunawayGuard({
      iteration: 7,
      lastIterationAt: "2026-02-26T12:00:00.000Z",
      previousDurations: [10, 25, 20, 30],
      now: new Date("2026-02-26T12:00:40.000Z"),
    });

    expect(result).toEqual({
      durations: [20, 30, 40],
      averageSeconds: 30,
      shouldStop: false,
    });
  });
});
