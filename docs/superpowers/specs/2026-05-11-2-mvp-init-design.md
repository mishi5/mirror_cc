# Phase 0: プロジェクト初期化 設計

- 対象 Issue: https://github.com/mishi5/mirror_cc/issues/2
- 親 Issue: https://github.com/mishi5/mirror_cc/issues/1
- 作成日: 2026-05-11

## 目的

Mirror C.C. の MVP 開発を進めるための土台 (ツールチェーン・ディレクトリ構成・テスト基盤) を整備する。本フェーズの成果は、後続 Phase 1〜6 のすべてが乗る基盤となる。

## ゴール (Definition of Done)

新規 clone 後に以下がすべて成立する。

1. `npm install` が成功する。
2. `npm run dev` で Vite 開発サーバが起動し、ブラウザに最低限の Three.js シーン (回転キューブ等) が表示される。
3. `npm run build` がエラーなく完了する。
4. `npm run preview` でビルド結果がプレビューできる。
5. `npm run test` で Vitest が起動し、サンプルテストが少なくとも1件パスする。
6. `npm run lint` がエラーなく完了する (warning は 0)。
7. `npm run format` で Prettier が走る。
8. `npx tsc --noEmit` がエラーなく完了する (strict 有効)。

## 技術スタックの決定

| 項目 | 採用 | 理由 |
|---|---|---|
| パッケージマネージャ | **npm** | CLAUDE.md で標準と明記。 |
| 言語 | **TypeScript (strict)** | プロジェクト方針。 |
| 開発サーバ / バンドラ | **Vite** | プロジェクト方針。Three.js / MediaPipe との実績豊富。 |
| 3D 描画 | **Three.js** | プロジェクト方針。 |
| Lint | **ESLint Flat config (eslint.config.js)** | v9 以降の新標準。typescript-eslint と Prettier 連携が公式対応済み。 |
| Format | **Prettier** | 標準。eslint-config-prettier で競合解消。 |
| テスト | **Vitest** | Vite と統合済み。デフォルト node 環境、必要に応じてファイル先頭の `// @vitest-environment jsdom` で切替。 |
| Three.js 型 | `@types/three` | Three.js 本体に同梱されない外部型定義を使用。 |

### Bun を採用しない理由

- CLAUDE.md で `npm` を標準と決定済みで、変更時はルール更新が必要。
- threejs-art スキルが `Bun の .glsl text import が信頼性低い` と既知罠として明記。Three.js + シェーダー前提の本プロジェクトでは地雷リスクが高い。
- 本プロジェクトは Vite + ブラウザ実行が主戦場で、Bun の利点 (サーバ高速化等) を享受しにくい。

将来的に Bun を採用する場合は別 Issue で検討する。

## ディレクトリ構成 (本フェーズで作成)

CLAUDE.md に記載の構成にしたがい、まずスケルトン (空ディレクトリには `.gitkeep`) を切る。実コードは src/main.ts と最低限のサンプルのみ。

```
mirror_cc/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── .prettierrc.json
├── .prettierignore
├── .gitignore                       # 既存に node_modules / dist / .vite を追加
├── README.md                        # 既存に setup 手順を追記
├── public/
│   └── .gitkeep
├── src/
│   ├── main.ts                      # エントリ。Three.js で回転キューブを描画。
│   ├── game/.gitkeep
│   ├── pose/
│   │   └── detectors/.gitkeep
│   ├── rendering/
│   │   ├── fighters/.gitkeep
│   │   ├── effects/.gitkeep
│   │   └── ui/.gitkeep
│   ├── scenes/.gitkeep
│   ├── audio/.gitkeep
│   └── debug/.gitkeep
├── tests/
│   └── smoke.test.ts                # サンプルテスト (常に成功)
└── docs/
    ├── plans/.gitkeep
    └── superpowers/
        ├── plans/.gitkeep
        └── specs/2026-05-11-2-mvp-init-design.md
```

`docs/superpowers/specs/` `docs/superpowers/plans/` `docs/plans/` の存在は CLAUDE.md で前提とされているため、空の場合も `.gitkeep` を置く。

## 設定ファイル詳細

### package.json (主要部分)

```jsonc
{
  "name": "mirror_cc",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "jsdom": "^24.0.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "eslint-config-prettier": "^9.0.0",
    "prettier": "^3.0.0",
    "globals": "^15.0.0"
  }
}
```

バージョンは実際のインストール時の最新安定版を採用。pin はせずキャレットで許容する。

### tsconfig.json

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests", "vite.config.ts", "eslint.config.js"]
}
```

### vite.config.ts

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node", // デフォルト node。DOM が必要なテストはファイル先頭で // @vitest-environment jsdom を指定。
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

### eslint.config.js (Flat config)

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", ".worktrees/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  prettier,
];
```

### .prettierrc.json

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

## 動作確認用コード

### src/main.ts

最低限の Three.js シーン (回転キューブ) を表示する。CLAUDE.md の注意点に従う:

- `renderer.setSize(w, h, false)` の第3引数は省略しない。今回は `false` を明示し、`renderer.setPixelRatio(window.devicePixelRatio)` で Retina 対応する。

### tests/smoke.test.ts

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("環境が正しく設定されている", () => {
    expect(1 + 1).toBe(2);
  });
});
```

## やらないこと (本フェーズの非ゴール)

- MediaPipe Pose Landmarker の導入 → Phase 1
- ゲームロジック・状態管理 → Phase 3
- アクション判定 → Phase 2
- 派手なエフェクトや UI → Phase 4
- AI / 試合フロー → Phase 5, 6

## 検証戦略

実装後、以下のコマンドを順に実行し、すべてエラーなく通ることを確認する。

```sh
npm install
npm run lint
npx tsc --noEmit
npm run test
npm run build
```

`npm run dev` の動作確認はユーザに依頼する (ブラウザ確認は手動)。
