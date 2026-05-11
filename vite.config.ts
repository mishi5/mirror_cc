/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    // テスト対象の多数派 (src/game/, src/pose/detectors/) は pure logic で DOM 不要。
    // Three.js 描画は WebGL が必要で jsdom でも単体テスト不可能なため、
    // jsdom をデフォルトにする利得が薄い。
    // DOM API が必要なテストファイルは先頭に // @vitest-environment jsdom を書く。
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
