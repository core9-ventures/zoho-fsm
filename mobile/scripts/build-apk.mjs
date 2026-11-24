// Builds the debug APK on this PC (Windows): builds the web app, syncs it into the Android project, finds Android
// Studio's Java and the Android SDK, runs Gradle, and copies the result to mobile/apk/fieldserve-debug.apk.
// Run through:  pnpm apk
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const win = process.platform === "win32";

const javaHome =
  process.env.JAVA_HOME ||
  ["C:\\Program Files\\Android\\Android Studio\\jbr", "/Applications/Android Studio.app/Contents/jbr/Contents/Home"].find(
    (p) => existsSync(p),
  );
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  [path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"), path.join(process.env.HOME ?? "", "Library/Android/sdk")].find(
    (p) => existsSync(p),
  );

if (!javaHome) throw new Error("Java not found. Install Android Studio, or set JAVA_HOME.");
if (!sdk) throw new Error("Android SDK not found. Install Android Studio, or set ANDROID_HOME.");

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, CAP_DEBUG: "1", JAVA_TOOL_OPTIONS: "-Djava.net.preferIPv4Stack=true", GRADLE_OPTS: "-Djava.net.preferIPv4Stack=true" };

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// pnpm may not be on the PATH (it often is not in PowerShell); corepack ships with Node and can run it.
const hasPnpm = spawnSync("pnpm", ["--version"], { env, shell: win, stdio: "ignore" }).status === 0;
const pnpm = (args) => (hasPnpm ? ["pnpm", args] : ["corepack", ["pnpm", ...args]]);

// 1. The web app, then copy it into the Android project.
run(...pnpm(["build"]), root);
run(...pnpm(["exec", "cap", "sync", "android"]), root);

// 2. Gradle reads the SDK folder from local.properties (this file is not committed).
writeFileSync(path.join(androidDir, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`);
run(win ? ".\\gradlew.bat" : "./gradlew", ["assembleDebug", "--no-daemon"], androidDir);

const built = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!existsSync(built)) throw new Error(`Build finished but ${built} is missing.`);
mkdirSync(path.join(root, "apk"), { recursive: true });
const target = path.join(root, "apk", "fieldserve-debug.apk");
copyFileSync(built, target);
console.log(`\nAPK ready: ${target}`);
