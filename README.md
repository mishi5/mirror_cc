# Mirror C.C.

カメラによるボーン認識を利用した C.C.レモンゲーム風の対戦ゲーム。

## 技術スタック

- TypeScript (strict)
- Vite (開発サーバ・ビルド)
- Three.js (3D 描画)
- MediaPipe Tasks - Pose Landmarker (姿勢推定, Phase 1 以降)
- Vitest (テスト)
- ESLint (Flat config) + Prettier

## 動作環境

- ブラウザ: Chrome 最新版を推奨 (MediaPipe Pose / WebGL の互換性が最も安定)
- Web カメラ: `getUserMedia` でアクセスするため、ブラウザのカメラ権限を許可する必要がある
- `npm run dev` は `http://localhost:5173` で配信されるため、開発時はカメラ API が localhost 例外で動作する

## セットアップ

Node.js 20+ と npm が必要。

```sh
npm install
```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Vite 開発サーバ起動 (http://localhost:5173) |
| `npm run build` | 型チェック + 本番ビルド (`dist/`) |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run test` | Vitest 全件実行 |
| `npm run test:watch` | Vitest watch モード |
| `npm run lint` | ESLint 実行 |
| `npm run lint:fix` | ESLint 自動修正 |
| `npm run format` | Prettier で整形 |
| `npx tsc --noEmit` | 型チェックのみ |

## プロジェクト構成

`CLAUDE.md` のアーキテクチャ節を参照。MVP の進捗は Issue #1 でトラッキングしている。

## ライセンス

未定。
