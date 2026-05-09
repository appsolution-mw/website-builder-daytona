/**
 * PreToolUse policy hooks for the Claude Agent SDK runner.
 *
 * Provides two layers:
 *
 *  1. Pure helper functions (`denyDestructiveBash`, `denyOutsideWorkspace`,
 *     `redactToolInput`) — easily unit-tested in isolation, no SDK types.
 *  2. `buildPolicyHooks(opts)` returns an internal-shape map of PreToolUse
 *     matchers + hook callbacks. Each callback takes a minimal
 *     `{ tool_input }` and returns `{ allow, reason? }`. When a hook denies
 *     it forwards a `ViolationEvent` via `opts.emitViolation`.
 *  3. `policyHooksToSdk(hooks)` adapts the internal shape to the SDK's
 *     `HookCallbackMatcher` shape (`HookCallback` taking `HookInput,
 *     toolUseID, { signal }` and returning `HookJSONOutput`).
 *
 * The split lets tests assert hook semantics directly while keeping the
 * SDK boundary narrow and a single place where the adapter can absorb
 * future SDK signature changes.
 */

import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Patterns that disqualify a Bash command outright. The list is intentionally
 * narrow: blunt destructive operations on system paths or filesystem devices.
 * Any normal development command (pnpm, git, ls, mkdir, etc.) passes.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // rm -rf <path> where path is NOT under /workspace/. Catches `/`, `/etc`,
  // `/root`, `~`, etc. The negative lookahead allows `/workspace/...`.
  /\brm\s+-rf?\s+\/(?!workspace\b)/,
  // Classic fork bomb `:(){ :|: & };:` (with whitespace tolerance).
  /:\s*\(\s*\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  // `dd if=/dev/zero|random|urandom ...` — common destructive disk wipe.
  /\bdd\s+if=\/dev\/(zero|random|urandom)/,
  // `mkfs` / `mkfs.ext4` / `mkfs ...` — formatting devices.
  /\bmkfs(\.|\s)/,
  // `dd of=/dev/...` — writing into device files.
  /\bdd\s+of=\/dev\//,
  // Redirect output to sensitive system locations.
  />\s*\/(etc|boot|root|var\/log|sys|proc)\b/,
];

/** Internal hook input — only the field policy hooks need. */
export interface HookInput {
  tool_input: Record<string, unknown> | undefined;
}

/** Internal hook result. `allow=false` triggers a violation emit + SDK block. */
export interface HookResult {
  allow: boolean;
  reason?: string;
}

/**
 * Block destructive Bash patterns. Empty/missing commands are allowed —
 * the SDK will surface its own validation errors.
 */
export async function denyDestructiveBash(
  input: HookInput,
): Promise<HookResult> {
  const cmd = String(input.tool_input?.command ?? "");
  if (cmd.length === 0) return { allow: true };
  for (const re of DESTRUCTIVE_PATTERNS) {
    if (re.test(cmd)) {
      return {
        allow: false,
        reason: `Destructive pattern blocked: ${re.source}`,
      };
    }
  }
  return { allow: true };
}

/**
 * Block Write/Edit operations targeting paths outside `/workspace/`. Missing
 * paths are denied (we cannot verify safety). Parent-segment escapes
 * (`..`) are denied even when the path begins with `/workspace/`.
 */
export async function denyOutsideWorkspace(
  input: HookInput,
): Promise<HookResult> {
  const raw = input.tool_input?.file_path ?? input.tool_input?.path;
  const path = typeof raw === "string" ? raw : "";
  if (path.length === 0) {
    return {
      allow: false,
      reason: "Path missing — cannot verify it is inside /workspace",
    };
  }
  if (/(?:^|\/)\.\.(?:\/|$)/.test(path)) {
    return { allow: false, reason: `Path contains parent segment: ${path}` };
  }
  if (!path.startsWith("/workspace/")) {
    return { allow: false, reason: `Path outside /workspace: ${path}` };
  }
  return { allow: true };
}

/**
 * Truncate string fields longer than 200 chars and append a marker. Used so
 * `agent.policy_violation` events never leak large payloads while still
 * carrying enough context to diagnose the block.
 */
export function redactToolInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = `${v.slice(0, 200)}...(truncated)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Payload emitted on every blocked tool call. */
export interface ViolationEvent {
  tool: string;
  reason: string;
  redactedInput: Record<string, unknown>;
}

export interface BuildHooksOptions {
  emitViolation: (v: ViolationEvent) => void;
}

/** Single matcher entry — internal shape used by tests. */
export interface PolicyHookEntry {
  matcher: string;
  hooks: Array<(input: HookInput) => Promise<HookResult>>;
}

/** Internal hooks map. `policyHooksToSdk` converts this to SDK shape. */
export interface PolicyHooks {
  PreToolUse: PolicyHookEntry[];
}

/**
 * Build the internal policy hooks. Each wrapper hook calls the underlying
 * predicate, and when the predicate denies, emits a `ViolationEvent` before
 * returning. The wrappers themselves remain plain `(HookInput) => HookResult`
 * so tests can invoke them directly.
 */
export function buildPolicyHooks(opts: BuildHooksOptions): PolicyHooks {
  const wrap =
    (tool: string, fn: (i: HookInput) => Promise<HookResult>) =>
    async (i: HookInput): Promise<HookResult> => {
      const r = await fn(i);
      if (!r.allow) {
        opts.emitViolation({
          tool,
          reason: r.reason ?? "blocked",
          redactedInput: redactToolInput(i.tool_input ?? {}),
        });
      }
      return r;
    };

  return {
    PreToolUse: [
      { matcher: "Bash", hooks: [wrap("Bash", denyDestructiveBash)] },
      { matcher: "Write|Edit", hooks: [wrap("Write|Edit", denyOutsideWorkspace)] },
    ],
  };
}

/**
 * Adapt the internal `PolicyHooks` shape to the SDK's `HookCallbackMatcher`
 * shape so it can be passed directly as `Options.hooks`.
 *
 * SDK callback signature: `(HookInput, toolUseID, { signal }) => Promise<HookJSONOutput>`.
 * On block, returns `{ decision: 'block', reason }`. On allow, returns `{}`.
 */
export function policyHooksToSdk(
  hooks: PolicyHooks,
): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: hooks.PreToolUse.map((entry) => ({
      matcher: entry.matcher,
      hooks: entry.hooks.map(
        (fn) =>
          // SDK calls with full PreToolUseHookInput; we narrow to tool_input.
          // _toolUseID and _options (containing AbortSignal) are intentionally
          // unused: current policy hooks are synchronous and stateless;
          // cancellation is not needed.
          (async (sdkInput, _toolUseID, _options): Promise<HookJSONOutput> => {
            const toolInput =
              (sdkInput as PreToolUseHookInput).tool_input ?? {};
            const result = await fn({
              tool_input:
                typeof toolInput === "object" && toolInput !== null
                  ? (toolInput as Record<string, unknown>)
                  : {},
            });
            if (result.allow) return {};
            return { decision: "block", reason: result.reason ?? "blocked" };
          }) as HookCallbackMatcher["hooks"][number],
      ),
    })),
  };
}
