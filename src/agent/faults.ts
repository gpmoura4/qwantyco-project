// Deterministic fault injection for tools (L3). Off by default. Tests pass faults
// to buildGraph directly; scripts and the app read SIMULATE_TOOL_FAILURE.

export type FaultMode = "error" | "timeout" | "invalid_output";

// Each call to the tool fails on its first `times` attempts, then works.
export type Fault = { mode: FaultMode; times: number };

export type Faults = Partial<Record<string, Fault>>;

// A technical, retryable failure (as opposed to business errors, which are data).
export class TransientToolError extends Error {
  name = "TransientToolError";
}

const MODES: FaultMode[] = ["error", "timeout", "invalid_output"];

// Parses "listar_chamados:error:2,get_ticket:timeout:1". Invalid entries throw,
// so a typo in .env is noticed instead of silently ignored.
export function parseFaults(value: string | undefined): Faults {
  const faults: Faults = {};
  for (const entry of (value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [tool, mode, times] = entry.split(":");
    const count = Number(times);
    if (!tool || !MODES.includes(mode as FaultMode) || !Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid SIMULATE_TOOL_FAILURE entry: "${entry}" (expected tool:mode:times).`);
    }
    faults[tool] = { mode: mode as FaultMode, times: count };
  }
  return faults;
}

// Never resolves on its own: only the node timeout (AbortSignal) ends it.
export function hangUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return reject(new Error("Simulated timeout requires an AbortSignal."));
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
