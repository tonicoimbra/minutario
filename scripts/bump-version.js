const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bump(v, kind) {
  if (kind === "patch") return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  if (kind === "minor") return { major: v.major, minor: v.minor + 1, patch: 0 };
  if (kind === "major") return { major: v.major + 1, minor: 0, patch: 0 };
  fail("Tipo inválido. Use: patch | minor | major");
}

function updateJsonVersion(filePath, newVersion, versionPath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);
  let target = obj;
  const parts = versionPath.split(".");
  for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
  target[parts[parts.length - 1]] = newVersion;
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`  ${filePath}`);
}

function main() {
  const kind = (process.argv[2] || "patch").toLowerCase();
  const root = process.cwd();

  const chromePath = path.join(root, "manifest.json");
  if (!fs.existsSync(chromePath)) fail("manifest.json não encontrado.");

  const current = parseSemver(String(JSON.parse(fs.readFileSync(chromePath, "utf8")).version || ""));
  if (!current) fail("Versão atual inválida em manifest.json. Esperado formato x.y.z");

  const next = bump(current, kind);
  const nextVersion = `${next.major}.${next.minor}.${next.patch}`;
  const prev = `${current.major}.${current.minor}.${current.patch}`;

  console.log(`Versão: ${prev} → ${nextVersion}`);

  updateJsonVersion(chromePath, nextVersion, "version");

  const firefoxPath = path.join(root, "firefox", "manifest.json");
  if (fs.existsSync(firefoxPath)) updateJsonVersion(firefoxPath, nextVersion, "version");

  const tauriPath = path.join(root, "minutario-desktop", "src-tauri", "tauri.conf.json");
  if (fs.existsSync(tauriPath)) updateJsonVersion(tauriPath, nextVersion, "version");
}

main();
