import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Colons in a macOS parent directory break npm PATH and Vite's URL/file checks.
// Keep the user's checkout authoritative; run tools from a private, colon-free mirror.
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "dev";
if (!["dev", "build", "test", "preview"].includes(command))
  throw new Error(`Unknown command: ${command}`);
const needsMirror = project.includes(":");
const cacheBase = homedir().includes(":")
  ? tmpdir()
  : join(homedir(), "Library", "Caches");
const runtime = needsMirror
  ? join(
      cacheBase,
      "PaperPilot",
      createHash("sha256").update(project).digest("hex").slice(0, 12),
    )
  : project;
const inputs = [
  "src",
  "public",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "server",
];
if (!existsSync(join(project, "node_modules")))
  throw new Error("Dependencies are missing. Run npm install first.");
if (needsMirror) {
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const fingerprint = createHash("sha256")
    .update(readFileSync(join(project, "package-lock.json")))
    .digest("hex");
  const stamp = join(runtime, ".dependency-fingerprint");
  if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint) {
    process.stdout.write(
      "Preparing local development tools for this workspace path…\n",
    );
    rmSync(join(runtime, "node_modules"), { recursive: true, force: true });
    cpSync(join(project, "node_modules"), join(runtime, "node_modules"), {
      recursive: true,
      dereference: true,
    });
    writeFileSync(stamp, fingerprint);
  }
  for (const name of inputs) {
    if (!existsSync(join(project, name))) continue;
    rmSync(join(runtime, name), { recursive: true, force: true });
    cpSync(join(project, name), join(runtime, name), { recursive: true });
  }
  if (command === "preview" && existsSync(join(project, "dist")))
    cpSync(join(project, "dist"), join(runtime, "dist"), { recursive: true });
}
let watcher;
if (needsMirror && command === "dev") {
  watcher = watch(project, { recursive: true }, (_type, filename) => {
    if (!filename) return;
    const path = filename.toString();
    if (!inputs.some((name) => path === name || path.startsWith(`${name}/`)))
      return;
    const source = join(project, path),
      target = join(runtime, path);
    if (relative(runtime, target).startsWith("..")) return;
    try {
      if (existsSync(source)) {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(source, target, { recursive: true });
      } else rmSync(target, { force: true, recursive: true });
    } catch {
      /* Editors can rename temp files while a file watcher is reading them. */
    }
  });
}
function run(args) {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, args, {
      cwd: runtime,
      stdio: "inherit",
    });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.on("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.on("exit", (code) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolveExit(code ?? 0);
    });
  });
}
let code = 0;
if (command === "build") {
  code = await run(["node_modules/typescript/bin/tsc", "-b"]);
  if (!code) code = await run(["node_modules/vite/bin/vite.js", "build"]);
  if (!code && needsMirror) {
    rmSync(join(project, "dist"), { recursive: true, force: true });
    cpSync(join(runtime, "dist"), join(project, "dist"), { recursive: true });
  }
} else if (command === "test")
  code = await run([
    "node_modules/vitest/vitest.mjs",
    "run",
    ...process.argv.slice(3),
  ]);
else
  code = await run([
    "node_modules/vite/bin/vite.js",
    ...(command === "preview" ? ["preview"] : []),
    "--host",
    "127.0.0.1",
    ...process.argv.slice(3),
  ]);
watcher?.close();
process.exitCode = code;
