export { SessionStateStore } from "./state/sessionState";
export type { SessionState, StartSessionOptions } from "./state/sessionState";

export { evaluateIdleLoop } from "./loop/idleLoop";
export type { IdleLoopAction, RunStatusSnapshot } from "./loop/idleLoop";

export { evaluateRunawayGuard } from "./loop/runawayGuard";
export type { RunawayGuardInput, RunawayGuardResult } from "./loop/runawayGuard";

export { HookDispatcher } from "./hooks/dispatcher";
export type {
  HookDispatchPayload,
  HookExecutionResult,
  HookDispatchResult,
  HookDispatcherOptions,
  HookCommandRunner,
} from "./hooks/dispatcher";

export { BabysitterCli, SpawnCommandExecutor } from "./cli/babysitterCli";
export type {
  RunStatusResult,
  CommandExecutor,
  CommandResult,
  CommandRunOptions,
  TaskListEntry,
  TaskPostOptions,
  TaskPostOkOptions,
  TaskPostErrorOptions,
} from "./cli/babysitterCli";

export { runNativeOrchestrator } from "./orchestrator/nativeOrchestrator";
export type {
  NativeOrchestratorAction,
  NativeOrchestratorOptions,
  NodeRunner,
  SkillRunner,
  AgentRunner,
  DelegatedTaskInput,
  DelegatedTaskResult,
  BreakpointClient,
  BreakpointCreateInput,
  BreakpointContextFile,
} from "./orchestrator/nativeOrchestrator";

export { CliBreakpointClient } from "./breakpoints/cliBreakpointClient";
export type { CliBreakpointClientOptions } from "./breakpoints/cliBreakpointClient";

export { createSessionSkillRunner, createSessionAgentRunner } from "./runners/sessionRunners";
export type { SessionRunnerOptions } from "./runners/sessionRunners";

export { createBabysitterRuntime, createBabysitterPluginHooks } from "./runtime";
export type {
  BabysitterRuntime,
  BabysitterRuntimeOptions,
  PluginLikeEvent,
  PluginLikeHooks,
  SessionPromptClient,
} from "./runtime";

export { createBabysitterToolHandlers, resolveSessionId } from "./tools/handlers";
export type {
  ToolContextLike,
  SetupArgs,
  ResumeArgs,
  AssociateArgs,
  StatusArgs,
  StopArgs,
  AskArgs,
  AskUserRequest,
  AskUserResponse,
  ScoreCriterion,
  ScoreArgs,
  ScoreResult,
  BabysitterToolHandlers,
} from "./tools/handlers";

export { createBabysitterPlugin, BabysitterPlugin } from "./plugin";
export type { CreateBabysitterPluginOptions } from "./plugin";
