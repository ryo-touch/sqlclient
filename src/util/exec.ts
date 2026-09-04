export interface ExecOptions {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdin?: "ignore" | "inherit";
  stdout?: "pipe" | "inherit";
  stderr?: "pipe" | "inherit";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (
  executable: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

function definedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

export const exec: Exec = async (executable, args, options = {}) => {
  const stdoutMode = options.stdout ?? "pipe";
  const stderrMode = options.stderr ?? "pipe";
  const process = Bun.spawn([executable, ...args], {
    cwd: options.cwd,
    env: options.env
      ? { ...processEnv(), ...definedEnvironment(options.env) }
      : undefined,
    stdin: options.stdin ?? "ignore",
    stdout: stdoutMode,
    stderr: stderrMode,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    stdoutMode === "pipe" ? new Response(process.stdout).text() : "",
    stderrMode === "pipe" ? new Response(process.stderr).text() : "",
    process.exited,
  ]);

  return { stdout, stderr, exitCode };
};

function processEnv(): Record<string, string> {
  return definedEnvironment(Bun.env);
}

export function findExecutable(
  name: string,
  fallbacks: readonly string[] = [],
): string | undefined {
  const fromPath = Bun.which(name);
  if (fromPath) return fromPath;

  for (const fallback of fallbacks) {
    if (Bun.file(fallback).size > 0) return fallback;
  }

  return undefined;
}
