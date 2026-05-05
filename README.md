# 京都一周トレイル

京都一周トレイル全 5 コース（東山・北山東部・北山西部・西山・京北）に対応したガイドマップ・進捗管理 PWA。スマートフォンでの GPS 利用と GitHub Pages での配信を前提にした、依存ゼロの静的 Web アプリ。

> 本線 84 km の連続ループ（伏見桃山〜比叡山〜大原〜鞍馬〜高雄〜嵐山〜苔寺）+ 京北エリアのループ。日をまたいで歩いても進捗が残り、5 コース全周完歩を集計します。

## 機能

| 機能 | 詳細 |
|---|---|
| **5 コース対応** | 東山 / 北山東部 / 北山西部 / 西山 / 京北 のメタ情報 + 4 コース実装済み（京北は OSM 未マップ） |
| **実 OSM ルート + GSI 標高** | OpenStreetMap (ODbL) の hiking relation と国土地理院 getelevation API を統合した実コースデータ |
| **マルチコース UI** | コース選択 → 6 タブ（標高 / 工程表 / CP 詳細 / 装備 / 補足情報 / 緊急）動的レンダリング |
| **進捗永続化** | localStorage の区間 union 方式で日跨ぎ完歩判定、Export / Import 対応 |
| **マップ上に走破済み区間** | 緑のオーバーレイで「歩いたルート」を可視化 |
| **カロリー精度** | 実累積標高 + ペース補正 ±10% + 体重・装備重量 UI 可変 |
| **経路追従補間** | 画面オフ中も歩いていれば再開時に区間を自動補間（5 条件ゲートでバス・電車を排除） |
| **Open-Meteo 天気** | 起動時に当日予報（最高/最低気温・降水・風・UV・日出/日没）を取得、警告バナー付き |
| **シミュレータ** | `?sim=<courseId>&speed=N` で京都に行かずに動作確認 |
| **PWA** | manifest + service worker でオフライン起動可能、地理院タイル stale-while-revalidate |
| **E2E テスト** | Playwright + GitHub Actions（Pixel 5 emulation, 週次本番 URL smoke） |

## 技術スタック

- 静的 HTML / Vanilla JS（依存ゼロ）
- [Leaflet 1.9](https://leafletjs.com/) — 地図
- [Chart.js 4.4](https://www.chartjs.org/) — 標高プロファイル
- [Turf.js 6.5](https://turfjs.org/) — 経路投影 / 距離計算
- [Open-Meteo API](https://open-meteo.com/) — 当日予報
- [国土地理院 標高API](https://maps.gsi.go.jp/development/elevation_s.html) — コースデータ標高
- [OpenStreetMap Overpass API](https://overpass-api.de/) — ルートジオメトリ
- [Playwright](https://playwright.dev/) — E2E テスト

## 開発

### ローカル起動

```bash
# 依存ゼロの静的 HTML なので、任意の HTTP サーバで OK
python3 -m http.server 8080
# または
npx http-server . -p 8080 -c-1
```

ブラウザで http://localhost:8080/ を開く。

### シミュレータでテスト

```
http://localhost:8080/?sim=nishiyama&speed=50
```

URL クエリ:
- `sim=<courseId>`: 自動でコース選択 + 倍速再生
- `speed=N`: 1.0 = 標準ペース 2.2km/h、推奨 50〜200x
- `interval=Ms`: GPS tick 間隔（既定 1000ms）
- `jitter=m`: ±ジッター（既定 10m）
- `shadow=1`: 実 GPS を取得しコース起点へ平行移動投影（実機テスト用）

### コース route データの再生成

```bash
node tools/fetch_kyoto_trail.js   # Overpass → data/courses/raw/*.geojson
node tools/build_courses.js       # raw + GSI elevation → data/courses/*.json
```

OSM データが更新された場合のみ実行。標高 API 呼び出しが各コース 150 ポイント × 200ms 待機なのでコース 1 本あたり約 30 秒。

### E2E テスト

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

本番 URL を smoke する場合:

```bash
BASE_URL=https://funmatu.github.io/kyototrailplan05/ npm run test:e2e
```

## デプロイ

GitHub Pages の Settings → Pages → Source = `main` branch / root で公開可能。Service Worker は HTTPS 必須なので `*.github.io` ドメインで自動的に動作する。

## ライセンス・データ出典

- **コードライセンス**: [MIT](LICENSE)
- **OpenStreetMap データ**: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/)
- **国土地理院標高データ**: 国土地理院ウェブサイト「[標高API](https://maps.gsi.go.jp/development/elevation_s.html)」
- **天気予報**: [Open-Meteo](https://open-meteo.com/) ([CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/))

## ロードマップ / 開発履歴

- [x] **Phase 0**: 西山ハードコードを `data/courses/nishiyama.json` に分離 (#1)
- [x] **Phase 1**: コース選択 UI + 6 タブ動的レンダリング (#1)
- [x] **Phase 2**: localStorage 永続化 + 全周ダッシュボード + Export/Import (#1)
- [x] **Phase 2.5**: カロリー精度（実累積標高・ペース補正・装備重量UI）(#1)
- [x] **Phase 2.7**: 経路追従補間モード（省電力 / 常時記録トグル + 5 条件ゲート）(#1)
- [x] **Phase 3**: OpenStreetMap + GSI elevation で 3 コース実装 (#2)
- [x] **Phase 3.5**: Open-Meteo 当日予報統合 (#3)
- [x] **Phase 4**: アプリ内 GPS シミュレータ (#4)
- [x] **Phase 5**: PWA（manifest + service worker + .nojekyll + icons）(#5)
- [x] **Phase 6**: Playwright E2E + GitHub Actions 週次ワークフロー (#6)
- [ ] **Phase 7**: 実機フィールドテスト（[手順書](docs/phase7-field-test.md)）

## 既知の制約

- **京北コース**: OpenStreetMap に hiking relation が登録されていないため `implemented:false`。手動データ提供 or 別ソース統合が必要
- **北山西部**: marker 70-90 区間が OSM 未マップのため、実 19.5km に対し 17.6km のみカバー
- **OS バックグラウンド GPS**: ブラウザ仕様で不可。Wake Lock + 経路追従補間で代替
