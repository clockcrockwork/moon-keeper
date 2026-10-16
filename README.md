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

## 公開・ライセンス・設定の扱い

- 月面テクスチャは Solar System Scope 提供（CC BY 4.0）。`moon.webp` と、それを 1024×512 に縮小・再エンコードした `moon-1k.webp` を使用。Three.js 0.160.0 は MIT ライセンス。出典・変更内容・ライセンス本文は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
- 設定はブラウザの `localStorage` に保存します。位置情報は「現在地を使う」を押した場合だけブラウザに許可を求め、座標は月の傾きの表示に使用します。現在地の送信APIは設けていませんが、ホスティング・CDN側の接続ログは別です。
- 共有URLに設定を含めますが、**正確な緯度・経度は含めません**。過去に生成されたリンクに位置情報が含まれていた可能性は残るため、そのリンクを公開した場合は差し替えを推奨します。
- Three.js は jsDelivr から配信します。第三者CDNへのアクセスは発生します（Cookie同意バナーを一律に追加するという意味ではありません）。
