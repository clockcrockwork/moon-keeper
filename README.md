# moon-keeper

## WebMCP（実験対応）

WebMCP の Imperative API（`document.modelContext.registerTool()`）に対応したブラウザでは、
AI エージェントから月飼いの見た目を自然言語経由で調整できます。

公開するツールは次の4つです。

- `get_moon_keeper_state` — 現在の設定とプリセットを取得
- `configure_moon_keeper_scene` — 月・星・水面・空・窓辺の光・時計を調整
- `apply_moon_keeper_preset` — 既存プリセットを適用
- `calm_moon_keeper_water` — 現在の波紋だけを消して凪がせる

WebMCP は progressive enhancement として実装しているため、未対応ブラウザでは登録処理を
スキップし、通常の月飼いの動作には影響しません。AI から変更できる項目は既存の設定 UI で
扱う範囲に限定し、実行時にも型・数値範囲・色形式・未知キーを検証します。
位置情報と描画品質は WebMCP から変更できません。

WebMCP は現在も実験仕様です。対応状況は Chrome の公式ドキュメントを確認してください。

https://developer.chrome.com/docs/ai/webmcp/imperative-api

### チェック

追加依存なしで WebMCP の設定境界とツール動作を確認できます。

```sh
node tools/check-webmcp.mjs
```
