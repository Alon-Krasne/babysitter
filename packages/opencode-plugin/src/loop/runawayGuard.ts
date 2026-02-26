export interface RunawayGuardInput {
  iteration: number;
  lastIterationAt: string;
  previousDurations: number[];
  now: Date;
}

export interface RunawayGuardResult {
  durations: number[];
  averageSeconds: number | null;
  shouldStop: boolean;
}

const RUNAWAY_THRESHOLD_SECONDS = 15;

export function evaluateRunawayGuard(input: RunawayGuardInput): RunawayGuardResult {
  const durations = input.previousDurations.filter((value) => Number.isInteger(value) && value > 0);

  if (input.iteration >= 5) {
    const previousEpoch = Date.parse(input.lastIterationAt);
    if (!Number.isNaN(previousEpoch)) {
      const nowEpoch = input.now.getTime();
      const deltaSeconds = Math.floor((nowEpoch - previousEpoch) / 1000);
      if (deltaSeconds > 0) {
        durations.push(deltaSeconds);
      }
    }
  }

  const compactDurations = durations.slice(-3);
  if (compactDurations.length < 3) {
    return {
      durations: compactDurations,
      averageSeconds: null,
      shouldStop: false,
    };
  }

  const sum = compactDurations.reduce((acc, value) => acc + value, 0);
  const averageSeconds = Math.floor(sum / compactDurations.length);

  return {
    durations: compactDurations,
    averageSeconds,
    shouldStop: averageSeconds <= RUNAWAY_THRESHOLD_SECONDS,
  };
}
