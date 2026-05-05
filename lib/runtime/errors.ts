export type RuntimeErrorCode = "NO_WORKER_CAPACITY";

export class RuntimeError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function isRuntimeError(
  error: unknown,
  code: RuntimeErrorCode,
): error is RuntimeError {
  return error instanceof RuntimeError && error.code === code;
}
