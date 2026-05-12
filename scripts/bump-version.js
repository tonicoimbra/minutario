const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bump(versionObj, kind) {
  if (kind === "patch") {
    return { major: versionObj.major, minor: versionObj.minor, patch: versionObj.patch + 1 };
  }
  if (kind === "minor") {
    return { major: versionObj.major, minor: versionObj.minor + 1, patch: 0 };
  }
  if (kind === "major") {
    return { major: versionObj.major + 1, minor: 0, patch: 0 };
  }
  fail("Tipo inválido. Use: patch | minor | major");
}

function main() {
  const kind = (process.argv[2] || "patch").toLowerCase();
  const manifestPath = path.join(process.cwd(), "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    fail("manifest.json não encontrado.");
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    fail("manifest.json inválido.");
  }

  const current = parseSemver(String(manifest.version || ""));
  if (!current) {
    fail("Versão atual inválida no manifest.json. Esperado formato x.y.z");
  }

  const next = bump(current, kind);
  const nextVersion = `${next.major}.${next.minor}.${next.patch}`;
  manifest.version = nextVersion;

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Versão atualizada: ${current.major}.${current.minor}.${current.patch} -> ${nextVersion}`);
}

main();
