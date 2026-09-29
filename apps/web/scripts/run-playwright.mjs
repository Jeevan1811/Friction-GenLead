import { spawn } from "node:child_process";

const testEnvironment = {
  ...process.env,
  AUTH_ALLOWED_EMAILS: "qa@example.invalid",
  AUTH_JWT_SECRET: "local-playwright-only-secret-not-for-any-environment",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:8011",
};

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: process.cwd(),
      env: testEnvironment,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with ${signal || code}`));
    });
  });
}

try {
  await runNpm(["run", "build"]);
  await runNpm(["exec", "--", "playwright", "test", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Playwright QA failed.");
  process.exitCode = 1;
}
