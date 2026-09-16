// Electron Forge config. Must be .cjs because package.json has "type": "module".
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "../..");
const sidecarBinary = path.join(
  repoRoot,
  "sidecar/applekit/.build/release/applekit"
);

// Packages kept external to the esbuild bundle (native binaries / runtime
// assets). They are copied into the packaged app with their full dependency
// closure from the workspace node_modules — the exact bits verified in dev.
const EXTERNAL_PACKAGES = [
  "@electric-sql/pglite",
  "pdfjs-dist",
  "@anthropic-ai/sandbox-runtime",
  "@huggingface/transformers",
];

function collectClosure(pkgName, rootModules, seen) {
  if (seen.has(pkgName)) return;
  const pkgDir = path.join(rootModules, pkgName);
  if (!fs.existsSync(pkgDir)) return; // platform-specific optional dep not installed
  seen.add(pkgName);
  let pkgJson;
  try {
    pkgJson = JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8")
    );
  } catch {
    return;
  }
  const deps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.optionalDependencies ?? {}),
  };
  for (const dep of Object.keys(deps)) {
    collectClosure(dep, rootModules, seen);
  }
}

module.exports = {
  packagerConfig: {
    name: "Mental Lab",
    executableName: "mental-lab",
    icon: "./icons/icon", // .icns appended automatically
    appBundleId: "ist.polymath.mentallab",
    appCategoryType: "public.app-category.productivity",
    appCopyright: "© 2026 Nav Virdi",
    // Everything is bundled or explicitly copied; keep Forge's dependency
    // walker out of node_modules (it cannot handle workspaces).
    prune: false,
    ignore: [/\/src\//, /dist-tsc/, /tsconfig\.json/, /node_modules/],
    extendInfo: {
      NSCalendarsUsageDescription:
        "Mental Lab syncs your calendar events into your knowledge vault.",
      NSCalendarsFullAccessUsageDescription:
        "Mental Lab syncs your calendar events into your knowledge vault.",
    },
    extraResource: fs.existsSync(sidecarBinary) ? [sidecarBinary] : [],
    // Developer ID signing + hardened runtime (required for notarization).
    // Set APPLE_SIGNING_IDENTITY to your own "Developer ID Application: …"
    // certificate name; without it the build is simply left unsigned.
    ...(process.env.APPLE_SIGNING_IDENTITY
      ? {
          osxSign: {
            identity: process.env.APPLE_SIGNING_IDENTITY,
            optionsForFile: (filePath) => ({
              hardenedRuntime: true,
              entitlements: filePath.endsWith("/applekit")
                ? path.join(__dirname, "entitlements.applekit.plist")
                : path.join(__dirname, "entitlements.plist"),
            }),
          },
        }
      : {}),
    // Set APPLE_NOTARY_PROFILE to a notarytool keychain profile name
    // (created with `xcrun notarytool store-credentials`) to notarize
    // as part of the build.
    ...(process.env.APPLE_NOTARY_PROFILE
      ? { osxNotarize: { keychainProfile: process.env.APPLE_NOTARY_PROFILE } }
      : {}),
    // Use the locally verified Electron zip instead of re-downloading
    // (the download cache on this machine has proven unreliable).
    ...(fs.existsSync(path.join(repoRoot, ".electron-zips"))
      ? { electronZipDir: path.join(repoRoot, ".electron-zips") }
      : {}),
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: (arch) => ({
        format: "ULFO",
        name: `MentalLab-${arch}`,
      }),
    },
  ],
  hooks: {
    generateAssets: async () => {
      console.log("Building production bundles…");
      execSync("node scripts/build.mjs", { cwd: repoRoot, stdio: "inherit" });
    },

    packageAfterCopy: async (_config, buildPath) => {
      // buildPath = <app>/Contents/Resources/app (copy of apps/main)

      // 1. Renderer + preload dists, where main.ts expects them when packaged.
      console.log("Staging renderer + preload…");
      fs.cpSync(
        path.join(repoRoot, "apps/renderer/dist"),
        path.join(buildPath, "renderer/dist"),
        { recursive: true }
      );
      fs.cpSync(
        path.join(repoRoot, "apps/preload/dist"),
        path.join(buildPath, "preload/dist"),
        { recursive: true }
      );

      // 2. External packages + transitive closure from workspace node_modules.
      console.log("Staging external packages…");
      const rootModules = path.join(repoRoot, "node_modules");
      const closure = new Set();
      for (const pkg of EXTERNAL_PACKAGES) {
        collectClosure(pkg, rootModules, closure);
      }
      const destModules = path.join(buildPath, "node_modules");
      for (const pkg of closure) {
        fs.cpSync(path.join(rootModules, pkg), path.join(destModules, pkg), {
          recursive: true,
          dereference: true,
        });
      }
      console.log(`Staged ${closure.size} packages`);

      // 3. A clean package.json for the packaged app.
      const appPkg = {
        name: "mental-lab",
        productName: "Mental Lab",
        version: JSON.parse(
          fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
        ).version,
        main: "dist/main.cjs",
      };
      fs.writeFileSync(
        path.join(buildPath, "package.json"),
        JSON.stringify(appPkg, null, 2)
      );
    },
  },
};
