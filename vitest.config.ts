import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // zxing wasm modülü worker thread'i canlı tutuyor ve koşum bitmiyor.
  // forks havuzunda süreç temiz kapanıyor.
  test: {
    pool: "forks",
    // Local release worktrees are snapshots, not tests of this revision.
    exclude: [...configDefaults.exclude, "**/artifacts/**"],
  },
});
