import { describe, expect, it, vi } from "vitest";
import { runConvergenceLoop, ConvergenceLoopCallbacks, QualityScoreResult } from "../qualityConvergenceLoop";

function makeCallbacks(scores: number[]): ConvergenceLoopCallbacks & {
  improveCalls: number[];
  endCalls: Array<{ iteration: number; converged: boolean }>;
} {
  let idx = 0;
  const improveCalls: number[] = [];
  const endCalls: Array<{ iteration: number; converged: boolean }> = [];

  return {
    improveCalls,
    endCalls,
    async score({ iteration }) {
      const score = idx < scores.length ? scores[idx] : scores[scores.length - 1];
      idx++;
      return {
        score,
        breakdown: [{ name: "quality", score, weight: 1 }],
        recommendations: score < 80 ? ["improve something"] : [],
      };
    },
    async improve({ iteration }) {
      improveCalls.push(iteration);
    },
    async onIterationEnd({ iteration, converged }) {
      endCalls.push({ iteration, converged });
    },
  };
}

describe("runConvergenceLoop", () => {
  it("converges when score meets target on first iteration", async () => {
    const callbacks = makeCallbacks([90]);

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 5,
    });

    expect(result.converged).toBe(true);
    expect(result.finalScore).toBe(90);
    expect(result.iterations).toBe(1);
    expect(result.reason).toBe("converged");
    expect(result.scoreHistory).toEqual([90]);
    expect(callbacks.improveCalls).toEqual([]);
    expect(callbacks.endCalls).toEqual([{ iteration: 1, converged: true }]);
  });

  it("iterates and converges after multiple rounds", async () => {
    const callbacks = makeCallbacks([40, 60, 75, 85]);

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 10,
    });

    expect(result.converged).toBe(true);
    expect(result.finalScore).toBe(85);
    expect(result.iterations).toBe(4);
    expect(result.reason).toBe("converged");
    expect(result.scoreHistory).toEqual([40, 60, 75, 85]);
    expect(callbacks.improveCalls).toEqual([1, 2, 3]);
  });

  it("stops at max iterations without convergence", async () => {
    const callbacks = makeCallbacks([30, 40, 50]);

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 3,
    });

    expect(result.converged).toBe(false);
    expect(result.finalScore).toBe(50);
    expect(result.iterations).toBe(3);
    expect(result.reason).toBe("max-iterations");
    expect(callbacks.improveCalls).toEqual([1, 2]);
  });

  it("detects stalling when improvement is below threshold", async () => {
    const callbacks = makeCallbacks([50, 51, 51]);

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 10,
      minImprovementPerIteration: 3,
    });

    expect(result.converged).toBe(false);
    expect(result.reason).toBe("stalled");
    // Stalling detected after score[1]=51, improvement=1 < minImprovement=3
    expect(result.iterations).toBe(2);
  });

  it("aborts when onIterationReview returns false", async () => {
    const callbacks = makeCallbacks([30, 40, 50, 60, 70, 80]);

    callbacks.onIterationReview = vi.fn(async ({ iteration }) => {
      return iteration < 3; // abort at iteration 3
    });

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 10,
    });

    expect(result.converged).toBe(false);
    expect(result.reason).toBe("aborted");
    expect(result.iterations).toBe(3);
    expect(result.finalScore).toBe(50);
  });

  it("uses default options when none are provided", async () => {
    const callbacks = makeCallbacks([85]);

    const result = await runConvergenceLoop(callbacks);

    expect(result.converged).toBe(true);
    expect(result.reason).toBe("converged");
  });

  it("clamps scores to 0-100 range", async () => {
    const callbacks = makeCallbacks([150]);

    const result = await runConvergenceLoop(callbacks, { targetScore: 80 });

    expect(result.converged).toBe(true);
    expect(result.finalScore).toBe(100);
  });

  it("carries recommendations and criticalIssues through lastScoreResult", async () => {
    const callbacks: ConvergenceLoopCallbacks = {
      async score() {
        return {
          score: 95,
          recommendations: ["polish docs"],
          criticalIssues: [],
          breakdown: [{ name: "docs", score: 95 }],
        };
      },
      async improve() {},
    };

    const result = await runConvergenceLoop(callbacks, { targetScore: 80 });

    expect(result.lastScoreResult.recommendations).toEqual(["polish docs"]);
    expect(result.lastScoreResult.criticalIssues).toEqual([]);
    expect(result.lastScoreResult.breakdown).toEqual([{ name: "docs", score: 95 }]);
  });

  it("handles single-iteration max", async () => {
    const callbacks = makeCallbacks([40]);

    const result = await runConvergenceLoop(callbacks, {
      targetScore: 80,
      maxIterations: 1,
    });

    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.reason).toBe("max-iterations");
    // improve should not be called when on last iteration
    expect(callbacks.improveCalls).toEqual([]);
  });
});
