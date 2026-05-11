import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", ".worktrees/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // src/: ブラウザ実行コード (Three.js / MediaPipe / DOM)。Node globals は与えない。
  // 誤って process.env.X 等を書いた場合に lint で検出できるようにする。
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // テストとビルド設定: Node API も使う可能性があるので両方の globals を許可。
  {
    files: ["tests/**/*.ts", "*.config.{js,ts,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  // 型情報を使うルール: floating promises 等のゲーム / ポーズ推定 / オーディオで
  // 致命的になりがちな async バグを検出する。projectService は typescript-eslint v8
  // 推奨方式で、tsconfig を自動解決する。
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  prettier,
];
