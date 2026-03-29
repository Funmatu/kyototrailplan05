#### `specs/implementation_plan.md`

**1. プロジェクト概要と実行環境**
* **目的:** 京都一周トレイル西山コースにおける、GPS軌跡、生体推計データ、標高プロファイルのリアルタイム同期型インフォグラフィックマップの構築。
* **デプロイ環境:** GitHub Pages (HTTPS接続必須)。
* **ファイル構成:** * `index.html` (UI, ロジック, スタイルを包含)
    * `route_data.json` (計画ルートのGeoJSON形式データ。事前にリポジトリに配置されている前提とする)
* **技術スタック:** HTML5, CSS3, Vanilla JavaScript (ES6+)。ビルドツール（Webpack等）は使用しない。

**2. 外部ライブラリの指定 (CDN)**
以下のライブラリを `index.html` の `<head>` 内で同期的に読み込むこと。バージョンは固定とする。
* **Leaflet.js:** `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`, CSS: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`
* **Chart.js:** `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js`
* **Turf.js:** `https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js` （幾何学計算・現在地投影用）

**3. 定数および生理学的パラメータの厳密な定義**
JavaScriptのグローバルスコープ直下に以下の定数を定義すること。
* `ROUTE_TOTAL_DISTANCE_KM`: 15.0
* `ROUTE_TOTAL_ASCENT_KM`: 0.827
* `ROUTE_TOTAL_DESCENT_KM`: 0.832
* `ROUTE_STANDARD_TIME_HR`: 6.8
* `TARGET_COURSE_CONSTANT`: 25.5
* `USER_BASE_WEIGHT_KG`: 60.0 (基礎体重)
* `GEAR_WEIGHT_KG`: 5.0 (装備重量)
* `TOTAL_WEIGHT_KG`: `USER_BASE_WEIGHT_KG` + `GEAR_WEIGHT_KG` (計算には必ずこの変数を使用すること)

**4. 状態管理 (State Management)**
アプリケーションの動的状態を単一のオブジェクトで管理すること。
```javascript
const AppState = {
    currentLocation: null, // {lat, lng, accuracy, speed}
    trajectory: [], // [{lat, lng, timestamp}]
    elapsedTimeMs: 0,
    startTimeMs: null,
    currentDistanceKm: 0,
    currentAscentKm: 0,
    currentDescentKm: 0
};
```

**5. UIおよびViewportの厳格な制御 (CSS/HTML)**
誤操作およびモバイルブラウザのリサイズバグを防止するため、以下を正確に実装すること。
* **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />`
* **CSS:**
    ```css
    * { box-sizing: border-box; }
    body, html { padding: 0; margin: 0; height: 100%; width: 100vw; overflow: hidden; background-color: #000; }
    #map { position: absolute; top: 0; left: 0; height: 60%; width: 100%; z-index: 1; }
    #dashboard { position: absolute; bottom: 0; left: 0; height: 40%; width: 100%; z-index: 10; background: rgba(255, 255, 255, 0.95); display: flex; flex-direction: column; }
    #chart-container { flex-grow: 1; position: relative; width: 100%; }
    ```

**6. 空間データの初期化と描画**
1.  `fetch('./route_data.json')` を用いて非同期で計画ルートデータを取得する。
2.  取得したデータを基に、Leafletで `L.geoJSON` を用いて「赤色の破線 (`color: 'red', dashArray: '5, 5'`)」で計画ルートを描画する。
3.  マップの初期ズームレベル制限は `minZoom: 13, maxZoom: 18` とする。タイルサーバーは国土地理院の標準地図 (`https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`) を使用する。

**7. Geolocation API と Wake Lock API の堅牢な実装**
* **Wake Lock API:** * 機能検知 (`if ('wakeLock' in navigator)`) を必ず行い、非対応ブラウザではコンソールへの警告のみで処理を続行させる。
    * 取得処理は `try...catch` で囲む。
    * `document.addEventListener('visibilitychange')` を実装し、`document.visibilityState === 'visible'` に戻った際にWake Lockを再取得する自己修復ロジックを組み込むこと。
* **Geolocation API:**
    * `navigator.geolocation.watchPosition` を使用。オプションは `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }`。
    * **エラーハンドリング:** GPS取得拒否やタイムアウト時のエラーコールバックを必ず実装し、UI上に一時的なエラーメッセージを表示すること。
    * **スロットリング:** `watchPosition` の発火頻度が高すぎる場合に備え、前回の処理から「3秒以上経過」かつ「精度 (accuracy) が50m以内」のデータのみを `AppState` に反映させるフィルタリング処理を実装すること。

**8. 動的データ可視化と計算ロジック**
GPS座標が有効として受理される度に、以下の手順で計算と再描画を行う。
1.  **現在地の投影:** Turf.jsの `turf.nearestPointOnLine` を使用し、計画ルート（GeoJSON）のLineStringに対する現在地の最短投影ポイントを計算。そこまでの累積距離を `AppState.currentDistanceKm` とする。
2.  **動的コース定数 ($C$) の推計:**
    * 数理的矛盾を防ぐため、経過時間を直接用いない。
    * 部分標準コースタイム $T_{current}$ を推定する: $T_{current} = ROUTE\_STANDARD\_TIME\_HR \times (AppState.currentDistanceKm / ROUTE\_TOTAL\_DISTANCE\_KM)$
    * 計算式: $C = 1.8 \times T_{current} + 0.3 \times AppState.currentDistanceKm + 10.0 \times AppState.currentAscentKm + 0.6 \times AppState.currentDescentKm$
    * *※累積標高の動的取得が困難な場合は、距離に応じた線形補間値を代入するフォールバックを実装すること。*
3.  **消費カロリー:** 上記で算出した $C \times TOTAL\_WEIGHT\_KG$。
4.  **Chart.jsの更新:** 初期描画された標高プロファイルグラフに対し、1. で得られた現在距離（X軸）に対応する位置に、アノテーションプラグインを使用するか、または別データセットとして縦線を描画し、`chart.update('none')`（アニメーションなし）で再描画する。
5.  **空間エフェクト:** 事前に定義されたピーク座標（配列）に対し、現在地との距離を Turf.js (`turf.distance`) で毎秒計算。半径50m以内に侵入した場合、該当座標に配置された `L.circleMarker` の `fillColor` を動的に変更する。

---
