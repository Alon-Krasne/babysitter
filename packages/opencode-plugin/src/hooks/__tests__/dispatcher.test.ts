import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookDispatcher } from "../dispatcher";

describe("HookDispatcher", () => {
  let rootDir: string;
  let worktree: string;
  let userConfigDir: string;
  let pluginRoot: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "babysitter-opencode-hooks-"));
    worktree = path.join(rootDir, "worktree");
    userConfigDir = path.join(rootDir, "user-config");
    pluginRoot = path.join(rootDir, "plugin");
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(userConfigDir, { recursive: true });
    await fs.mkdir(pluginRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("runs hooks in repo -> user -> plugin order", async () => {
    await createHookScript(path.join(worktree, ".a5c", "hooks", "on-iteration-start", "10-repo.sh"), "repo-ok", 0);
    await createHookScript(
      path.join(userConfigDir, "babysitter", "hooks", "on-iteration-start", "20-user.sh"),
      "user-ok",
      0
    );
    await createHookScript(path.join(pluginRoot, "hooks", "on-iteration-start", "30-plugin.sh"), "plugin-ok", 0);

    const dispatcher = new HookDispatcher({
      worktree,
      pluginRoot,
      userConfigDir,
    });

    const result = await dispatcher.dispatch("on-iteration-start", {
      runId: "run-1",
      iteration: 1,
    });

    expect(result.hookName).toBe("on-iteration-start");
    expect(result.results).toHaveLength(3);
    expect(result.results.map((entry) => entry.source)).toEqual(["repo", "user", "plugin"]);
    expect(result.results.every((entry) => entry.success)).toBe(true);
    expect(result.results[0]?.stdout).toContain("repo-ok");
    expect(result.results[1]?.stdout).toContain("user-ok");
    expect(result.results[2]?.stdout).toContain("plugin-ok");
  });

  it("records failures without aborting dispatch", async () => {
    await createHookScript(path.join(worktree, ".a5c", "hooks", "on-run-complete", "10-ok.sh"), "ok", 0);
    await createHookScript(path.join(worktree, ".a5c", "hooks", "on-run-complete", "20-fail.sh"), "boom", 4);
    await createHookScript(path.join(worktree, ".a5c", "hooks", "on-run-complete", "30-last.sh"), "last", 0);

    const dispatcher = new HookDispatcher({
      worktree,
      userConfigDir,
    });

    const result = await dispatcher.dispatch("on-run-complete", { runId: "run-2" });
    expect(result.results).toHaveLength(3);
    expect(result.results.map((entry) => entry.exitCode)).toEqual([0, 4, 0]);
    expect(result.results.map((entry) => entry.success)).toEqual([true, false, true]);
  });
});

async function createHookScript(filePath: string, label: string, exitCode: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const script = [
    "#!/bin/sh",
    "payload=$(cat)",
    "printf '%s\n' \"$payload\" >/dev/null",
    `printf '${label}\\n'`,
    `exit ${exitCode}`,
  ].join("\n");
  await fs.writeFile(filePath, `${script}\n`, "utf8");
  await fs.chmod(filePath, 0o755);
}
