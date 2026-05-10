# CLAUDE.md — Mirror C.C. プロジェクト共通ルール

カメラによるボーン認識を利用した C.C.レモンゲーム風の対戦ゲーム。
TypeScript + Vite + Three.js + MediaPipe Pose Landmarker で構築する。

## 必須ワークフロー

- **Issue対応時は必ず `.claude/rules/git.md` の worktree フローに従うこと。main ブランチで直接作業しない。**
- **対応中に既存バグを発見した場合のフローも `.claude/rules/git.md` を参照。**

## アーキテクチャ（予定）

MVP セットアップ完了時に確定する。現時点での想定は以下:

```
index.html             # Vite エントリ HTML
vite.config.ts         # Vite 設定
package.json           # 依存・スクリプト
tsconfig.json          # TypeScript 設定
src/
  main.ts              # エントリポイント
  game/
    constants.ts       # ゲーム全体の定数（HP、チャージランク閾値、クールタイム等）
    state.ts           # プレイヤー・敵の状態管理（HP, チャージ, アクション）
    rules.ts           # 三すくみ判定ロジック
    ai.ts              # 敵 AI の行動選択
  pose/
    landmarker.ts      # MediaPipe Pose Landmarker のラッパ
    detectors/         # チャージ・ガード・アタック姿勢の判定
  rendering/
    scene.ts           # Three.js シーン初期化
    fighters/          # プレイヤー・敵の 3D 表現
    effects/           # ビーム・シールド・オーラなどのエフェクト
    ui/                # HP/チャージゲージなどの UI
  scenes/              # タイトル / キャリブレーション / 試合 / リザルト
  audio/               # SE / BGM
  debug/               # デバッグオーバーレイ・パラメータ調整
public/                # 静的アセット
docs/
  plans/               # 実装計画ドキュメント（worktree 内で作成）
  superpowers/
    plans/             # superpowers スキル経由で作成する実装計画
    specs/             # superpowers スキル経由で作成する設計仕様
tests/                 # vitest テスト群
```

## コマンド実行ルール

> **⚠️ 複数コマンドを `&&` や `;` で連結せず、原則1コマンドずつ別々に実行すること。⚠️**
>
> - **禁止**: `cd .worktrees/foo && npm run test`、`git add -A && git commit -m "..."` など
> - **正しい**: 各コマンドを個別のBashツール呼び出しで実行する
> - **理由**: 複合コマンドはユーザに過剰な確認を求めることになるため
> - **例外**: パイプ (`|`) など分離不可能な場合は連結してよい

## コマンド（MVP セットアップ後に確定）

```bash
npm run dev       # Vite 開発サーバ起動
npm run build     # 本番ビルド
npm run preview   # ビルド結果のプレビュー
npm run test      # vitest 実行（全件）
npm run lint      # ESLint
npm run format    # Prettier
npx tsc --noEmit  # 型チェック
```

## 環境・依存

- Node.js LTS（v20+ 想定）
- TypeScript
- Vite（開発サーバ・ビルド）
- Three.js（3D 描画）
- MediaPipe Tasks - Pose Landmarker（姿勢推定）
- vitest（テスト）
- ESLint + Prettier（lint / formatter）

## パッケージ管理

- `npm` を標準とする（`npm install`, `npm run` など）
- `pnpm` / `yarn` を導入したい場合は事前にユーザと合意し、CLAUDE.md を更新してから切り替える

## テスト

- 実装前にテストを書く（TDD）
- 常に `npm run test` で全テストが通ることを確認してからコミット
- 型チェック（`npx tsc --noEmit`）も併せてグリーンを保つこと

## ドキュメント

- 設計・実装計画は `docs/plans/` 配下に `YYYY-MM-DD-<番号>-<slug>.md` 形式で作成する
- plan / spec には対象 Issue の URL（`https://github.com/mishi5/mirror_cc/issues/<番号>`）を必ず記載する
- 複数 Issue にまたがる場合は全て列挙する

## エフェクト・ビジュアル描画のルール

### 方向性を持つエフェクト（ビーム・斬撃線など）の方向ルール

**「線の明るい・太い端が、攻撃の進行方向（先端）を示す」** ことを常に確認すること。

- プレイヤーが**前方**に攻撃 → エフェクトはプレイヤーの**前方**に伸びる
  - 始点（プレイヤー寄り）= 透明 / 細
  - 終点（プレイヤーから遠い側）= 明るく / 太い

**逆にすると「攻撃がプレイヤーに向かって飛んでくる」ように見えるため厳禁。**
モックアップや実装後に必ず「どこから来てどこへ向かう攻撃に見えるか」を確認すること。

### Three.js / シェーダー実装の注意点

- `renderer.setSize(w, h, false)` の第3引数を省略 / `true` にすると Retina で表示が崩れることがある
- GLSL ソースは ASCII のみで書く（マルチバイト混入で silently 死ぬ）
- `int` uniform での分岐や、uniform 配列の動的インデックス参照は避ける
- Vite で `.glsl` を文字列として import する場合は `?raw` を明示する
