/**
 * Reusable quality convergence loop.
 *
 * Parity with the Claude Code `process/tdd-quality-convergence.js` pattern:
 *   score -> check threshold -> improve -> re-score
 *
 * The loop is process-agnostic: callers provide scoring and improvement
 * callbacks, and this module drives the iteration + threshold logic.
 */

export interface QualityScoreResult {
  /** Overall quality score 0-100. */
  score: number;
  /** Per-dimension breakdown (optional). */
  breakdown?: Array<{ name: string; score: number; weight?: number }>;
  /** Actionable recommendations for improvement. */
  recommendations?: string[];
  /** Critical issues that must be fixed. */
  criticalIssues?: string[];
}

export interface ConvergenceLoopCallbacks {
  /** Evaluate current quality and return a score. */
  score(context: { iteration: number; previousScore?: number }): Promise<QualityScoreResult>;
  /** Attempt to improve quality based on the latest score result. */
  improve(context: {
    iteration: number;
    scoreResult: QualityScoreResult;
  }): Promise<void>;
  /**
   * Optional: called when a breakpoint/review is needed between iterations.
   * Return `true` to continue, `false` to abort.
   */
  onIterationReview?(context: {
    iteration: number;
    scoreResult: QualityScoreResult;
    targetScore: number;
  }): Promise<boolean>;
  /** Optional: called at the end of each iteration for telemetry/logging. */
  onIterationEnd?(context: {
    iteration: number;
    scoreResult: QualityScoreResult;
    converged: boolean;
  }): Promise<void>;
}

export interface ConvergenceLoopOptions {
  /** Target quality score to converge to (default: 80). */
  targetScore?: number;
  /** Maximum iterations before giving up (default: 10). */
  maxIterations?: number;
  /** Minimum score improvement per iteration to avoid stalling (default: 0 = disabled). */
  minImprovementPerIteration?: number;
}

export interface ConvergenceLoopResult {
  /** Whether the target quality score was reached. */
  converged: boolean;
  /** Final quality score. */
  finalScore: number;
  /** Number of iterations executed. */
  iterations: number;
  /** Score history across iterations. */
  scoreHistory: number[];
  /** Reason for termination. */
  reason: "converged" | "max-iterations" | "stalled" | "aborted";
  /** Last score result with full details. */
  lastScoreResult: QualityScoreResult;
}

export async function runConvergenceLoop(
  callbacks: ConvergenceLoopCallbacks,
  options: ConvergenceLoopOptions = {}
): Promise<ConvergenceLoopResult> {
  const targetScore = clamp(options.targetScore ?? 80, 0, 100);
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 10));
  const minImprovement = options.minImprovementPerIteration ?? 0;

  const scoreHistory: number[] = [];
  let lastScoreResult: QualityScoreResult = { score: 0 };
  let converged = false;
  let reason: ConvergenceLoopResult["reason"] = "max-iterations";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const previousScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : undefined;

    // 1. Score current quality
    const scoreResult = await callbacks.score({ iteration, previousScore });
    const currentScore = clamp(Math.round(scoreResult.score), 0, 100);
    scoreHistory.push(currentScore);
    lastScoreResult = { ...scoreResult, score: currentScore };

    // 2. Check convergence
    if (currentScore >= targetScore) {
      converged = true;
      reason = "converged";
      await callbacks.onIterationEnd?.({ iteration, scoreResult: lastScoreResult, converged: true });
      break;
    }

    // 3. Check stalling
    if (
      minImprovement > 0 &&
      previousScore !== undefined &&
      currentScore - previousScore < minImprovement
    ) {
      reason = "stalled";
      await callbacks.onIterationEnd?.({ iteration, scoreResult: lastScoreResult, converged: false });
      break;
    }

    // 4. Optional iteration review (breakpoint/human check)
    if (callbacks.onIterationReview) {
      const shouldContinue = await callbacks.onIterationReview({
        iteration,
        scoreResult: lastScoreResult,
        targetScore,
      });
      if (!shouldContinue) {
        reason = "aborted";
        await callbacks.onIterationEnd?.({ iteration, scoreResult: lastScoreResult, converged: false });
        break;
      }
    }

    // 5. Improve
    if (iteration < maxIterations) {
      await callbacks.improve({ iteration, scoreResult: lastScoreResult });
    }

    await callbacks.onIterationEnd?.({ iteration, scoreResult: lastScoreResult, converged: false });
  }

  return {
    converged,
    finalScore: scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : 0,
    iterations: scoreHistory.length,
    scoreHistory,
    reason,
    lastScoreResult,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
