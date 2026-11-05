# Third-party notices / 素材・ライセンス表示

このリポジトリの独自ソースコードと、以下の第三者の素材・プログラムの権利は別です。

## Solar System Scope — Moon texture

- 出典・権利者: [Solar System Scope](https://www.solarsystemscope.com/textures/)
- 利用条件: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- 対象: `moon.webp`, `moon-1k.webp`, `ogp.jpg`（SNS共有用画像。月の部分にこのテクスチャを含む）
- 加工: サイト用のWebP画像を使用。`moon-1k.webp` は `moon.webp` を 2048×1024 → 1024×512 に縮小し、WebPとして再エンコードしたものです（`tools/make-moon-1k.mjs`）。描画時にはシェーダーで光・陰影などを合成します。`ogp.jpg` はこの描画結果を 1200×630 で撮影したものです（`tools/make-ogp.mjs`）。
- ライセンスの表示は素材の許諾条件に基づくもので、Solar System Scopeが本サイトを推薦・後援していることを意味しません。

## Noto Serif JP — SIL Open Font License 1.1

- 出典: [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Serif+JP)
- 対象: `ogp.jpg` の「月飼い」の文字（撮影時に3文字分だけ読み込み、画像として焼き込み）。フォントファイル自体はリポジトリに含まず、サイトの表示にも使いません。
- ライセンス: https://openfontlicense.org/

## Three.js v0.160.0 — MIT License

- 公式: https://threejs.org/
- 配信: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`
- ライセンス原文: https://github.com/mrdoob/three.js/blob/r160/LICENSE

The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
