import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const globalNpmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const sdkPath = join(globalNpmRoot, "@dbx-app", "plugin-cli", "sdk-root", "plugins", "sdk", "rust", "dbx-plugin-sdk");

if (!existsSync(join(sdkPath, "Cargo.toml"))) {
  console.error("DBX Rust SDK not found. Install @dbx-app/plugin-cli globally before running tests.");
  process.exit(1);
}

execFileSync("cargo", [
  "test",
  "--manifest-path", "backend/Cargo.toml",
  "--config", `patch.crates-io.dbx-plugin-sdk.path=${JSON.stringify(sdkPath)}`
], { stdio: "inherit" });
