# **京都一周トレイル西山コースにおける最適運動強度ルートの策定およびリアルタイムGPS同期型インフォグラフィックマップの実装要件定義**

## **1\. 運動強度（コース定数）の数理学的枠組みと生理学的評価指標**

登山やトレッキングにおける疲労度や必要エネルギー量を客観的に評価する指標として、近年広く採用されているのが「コース定数」と呼ばれる数理モデルである1。この定数は、単なる平面上の移動距離だけでなく、山岳地帯特有の地形的起伏や標準的な歩行時間を総合的に加味して算出されるため、行動計画の立案や安全管理において極めて重要な役割を果たす。この指標を理解し適用することは、参加者の体力水準に合致したルートを選定し、遭難や熱中症といったリスクを未然に防ぐための第一歩となる。

コース定数（![][image1]）を導出するための数理モデルは、以下の重回帰的な方程式によって定義されている1。

![][image2]  
本方程式において、![][image3]は標準コースタイム（単位：時間）、![][image4]は歩行距離（単位：km）、$A\_{up}$は上り累積標高（単位：km）、$A\_{down}$は下り累積標高（単位：km）を示す1。各変数に付与された係数は、平地歩行と比較した際の生理学的なエネルギー代謝率の違いを反映している。特に、上り累積標高に対する係数（10.0）が極めて大きく設定されている点は、抗重力運動が骨格筋および心肺機能に与える負荷の甚大さを定量的に示している。一方、下り累積標高に対する係数（0.6）は比較的小さいものの、エキセントリック収縮（伸張性収縮）による筋線維への微細な損傷や関節への衝撃負荷を考慮した重要なパラメータである。

算出されたコース定数は、そのまま登山の難易度を分類する基準として機能する。一般的な目安として、コース定数10前後のルートは「超初心者でも安全に登れる水準」とされ、20前後のルートは「初心者向けでありながら歩いたという確かな達成感を得られるレベル」に位置付けられる。さらに数値が上がり30に達すると、「経験者向けであり初心者には厳しいレベル」へと移行する2。日本国内の代表的な山岳ルートと比較すると、蔵王山（地蔵山頂駅からの往復）がコース定数11、立山（室堂からの往復）が19、富士山（吉田口往復）が41というリファレンス値が設定されており、これらとの相対比較によって対象ルートの絶対的な困難度を推し量ることが可能である1。

さらに、このコース定数は行動中のエネルギー消費量および必要な水分補給量を推定するための基礎データとしても機能する。生理学的な推計式によれば、行動中のエネルギー消費量（kcal）は「コース定数 ![][image5] （体重＋ザックの重量）」として算出され、水分消費量（ml）もこれとほぼ同等と見なされる3。体力の消耗や熱中症を防ぐためには、この算出結果の7割から8割を目安に水分およびエネルギーを補給することが推奨されており、夏季においてはさらに多めの設定が要求される3。したがって、安全かつ科学的なトレッキング計画を立案するためには、目的とするコース定数に合致するよう、距離と標高差を戦略的に組み合わせ、それに伴う補給計画を同時に策定する必要がある。

## **2\. 西山コース初期計画案の地理的解析と課題抽出**

京都一周トレイルは、京都市の周囲を取り囲む山々を巡る総延長約80km超の長距離自然歩道であり、東山、北山東部、北山西部、西山、京北の5つの主要コースから構成されている4。その中で西山コースは、清滝を起点として南下し、上桂に至る全長12.3kmの区間を指す4。このエリアは、嵐山の豊かな自然美を享受しながら、西芳寺（苔寺）や天龍寺といった歴史的に重要な寺社仏閣を参拝することも可能であり、伝統と自然が交差する京都ならではの文化的景観を提供する4。

初期のユーザー計画案（阪急嵐山駅をスタートし、渡月橋を経て松尾山登山口へ向かい、松尾山、嵐山、烏ヶ岳を縦走した後、嵐山公園亀山地区または保津峡方面へ下山するルート）について、過去のGPS踏査データを用いて定量的な評価を実施する。このルートは、渡月橋南側の櫟谷宗像神社付近からアプローチし、整備された登山道を経て標高276mの松尾山山頂に至る。その後、尾根沿いの適度なアップダウンを経て標高382mの嵐山山頂、さらに烏ヶ岳へと進む構成となっている。

関連するGPSトラックデータによれば、松尾山から烏ヶ岳を経て、大悲閣千光寺や渡月橋へと戻る周回ルートの総歩行距離は約6.3km、上り累積標高は約425m（0.425km）、下り累積標高は約427m（0.427km）であると記録されている5。この行程の標準的な所要時間は、休憩を含めて約3時間程度と推計される。

これらのパラメータを前述のコース定数算出モデルに適用すると、以下の結果が得られる。

![][image6]  
算出されたコース定数11.8という数値は、前述の基準に照らし合わせると「超初心者でも安全に登れる水準」に該当し、目標として設定された「コース定数20〜30」の範囲を大きく下回っていることが明白である2。半日程度の軽いハイキングとしては適当であるものの、明確な達成感を求める計画としては運動強度が不足していると結論付けられる5。

さらに、この初期ルートの下山経路として想定される保津峡・千光寺方面への道程には、地形的および管理上のリスクが内包されている。過去の踏査記録によれば、烏ヶ岳から保津川沿いの千光寺へ下るルートは、わずか500mの歩行距離に対して約250mもの急激な標高低下を伴う5。雨上がりなど土壌が軟弱な状態では足元が深く沈み込み、スリップの危険性が著しく高まるため、トラロープや樹木の枝を頼りに下降せざるを得ない厳しい環境であると報告されている5。加えて、この区間を下から登り返す場合には、ハイカーの立ち入りを制限する門やネットを通過する必要が生じる可能性があり、千光寺を経由するルート設定自体が初心者向けとしては敷居が高いという課題が存在する5。

## **3\. 標的運動強度（定数20-30）を満たす最適化ルートの策定**

目標値であるコース定数20〜30を達成し、かつ初心者から中級者へのステップアップに相応しい安全性を担保するためには、急峻なバリエーションルートを下るのではなく、京都一周トレイルの公式な主稜線をさらに南下し、上桂方面まで縦走する長距離計画へと再構築することが数理学的に最適である。具体的には、標識番号24番（阪急嵐山駅）を起点とし、松尾山、嵐山、烏ヶ岳の主要ピークを越えた後、さらに南の沓掛山（くつかけやま）を経由して標識番号51番付近の上桂駅へと至る完全な西山南部縦走ルートを提案する。

この縦走ルートのGPSログデータを用いた実証的解析によれば、総歩行距離は11.5kmから15.0kmの範囲で変動し（アプローチの選択による）、上り累積標高は約702mから827m、下り累積標高は約654mから832mに達する6。ここでは、最も詳細な踏査データに基づく安全な歩行ペースを想定し、総距離15.0km、上り累積標高0.827km、下り累積標高0.832km、標準コースタイム6.8時間（約6時間48分）のパラメータを採用して評価を行う8。

この最適化パラメータを用いてコース定数を再計算する。

![][image7]  
![][image8]  
新たに導出されたコース定数25.5は、目標範囲である20〜30のほぼ中央に位置する理想的な数値である2。この計画は、長時間にわたる有酸素運動を要求される一方で、極端な急登や危険箇所が少ない尾根道を主体としているため、運動強度の目標を達成しつつ安全性を損なわない合理的な設計となっている。

| 経由地（チェックポイント） | 累積距離推計 (km) | 標高 (m) | 地形的特性および環境評価 |
| :---- | :---- | :---- | :---- |
| 阪急嵐山駅 (起点) | 0.0 | 約40 | 市街地。出発前の飲料水確保およびGPSキャリブレーションの基点8。 |
| トレイル西山26番標識 | 1.5 | 約50 | 松尾山への本格的な登山口。住宅地に唐突に現れるアプローチ6。 |
| 松尾山 山頂 | 3.0 | 276 | 整備された登山道。過去の台風による倒木の影響が一部報告されているが通行可能6。 |
| 嵐山 山頂 | 4.5 | 382 | 尾根沿いの歩行。一部に岩場を含むが踏み跡は明瞭である8。 |
| 烏ヶ岳 山頂 | 6.0 | 約390 | 小刻みなアップダウンが連続し、疲労が蓄積しやすい区間。 |
| 山上ヶ峰 〜 P407 | 8.5 | 407 | コース上の最高標高点周辺。樹林帯が続き展望は限定的8。 |
| 沓掛山 山頂 | 11.5 | 415 | 西芳寺川林道からのアプローチ。大雨後には林道に落石が見られるため足元に注意が必要6。 |
| 上桂駅 (終点) | 15.0 | 約40 | 丁塚を経て市街地へ下山。トレイル西山51番標識方面へと接続する8。 |

本ルートを採用する場合、事前のエネルギー管理計画が極めて重要となる。例えば、体重と装備重量の合計を65kgと仮定した場合、行動中の推計消費カロリーは約1,657kcal（![][image9]）に達し、同等量（約1.6〜1.7リットル）の水分消費が予測される3。ルート上には嵐山市街地を離れると自動販売機等の補給施設が皆無であるため、十分な水分と行動食（糖質および電解質）の携行が絶対条件となる6。

## **4\. リアルタイムGPS同期型インフォグラフィックマップのアーキテクチャ定義**

上述のトレッキング計画において、ユーザーの現在位置、運動軌跡、時刻情報、および生体推計データを視覚的に統合し、スマートフォン上で動的に提示するインフォグラフィックマップを構築するためには、最新のWeb標準技術（HTML5, CSS3, JavaScript）を駆使したSPA（Single Page Application）の設計が要請される。ネイティブアプリに依存せず、モバイルブラウザ上で堅牢に動作するシステムを構築するための要件を体系的に論じる。

### **4.1 モバイルブラウザに最適化されたビューポートとUI制御の基盤**

野外という過酷な環境下での視認性と直感的な操作性を担保するため、アプリケーションのUIはフルスクリーンで展開されなければならない。HTMLの\<head\>要素内に専用のメタタグを配置し、ユーザーによる意図しない拡大縮小（ピンチアウト操作等によるレイアウトの崩壊）を物理的に防止し、デバイスの物理的解像度とCSSピクセルを厳密に同期させる要件が不可欠である9。

HTML

\<meta name\="viewport" content\="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" /\>

さらに、モバイルブラウザ（特にiOS SafariおよびAndroid Chrome）における特有の挙動として、スクロールに伴うアドレスバーやナビゲーションバーの動的表示による縦幅（Viewport Height）の変動が存在する。CSSにおいて height: 100vh を用いると、このUIバーの表示・非表示の切り替えに伴って画面下部がクリップされたり、予期せぬリサイズイベントが多発するバグが発生する9。これを根本から回避するためには、絶対的なパーセンテージ指定を用いる以下のCSSリセットが推奨される。

CSS

body, html {  
    padding: 0;  
    margin: 0;  
    height: 100%;  
    width: 100vw;  
    overflow: hidden;  
}  
\#map {  
    height: 100%;  
    width: 100%;  
}

これにより、後述するLeaflet.jsのレンダリングキャンバスが画面の描画可能領域を正確かつ安定的に占有し、デバイスの回転（オリエンテーション変更）や指でのスクロール操作による描画欠損を完全に防ぐことができる。

### **4.2 地図描画エンジン「Leaflet.js」の導入とレイヤ管理戦略**

インタラクティブな地図描画の中核エンジンとして、軽量かつモバイルパフォーマンスに極めて優れたオープンソースJavaScriptライブラリである「Leaflet.js」を採用する。Leaflet.jsはコアのファイルサイズが約42KBと非常に小さく、山間部などの通信帯域が著しく制限される低速ネットワーク環境下における初期ロード時間の短縮に大きく寄与する10。

Leafletの初期化プロセスでは、WGS84座標系に基づく地理的中心点と初期ズームレベルを設定し、ベースマップとなるタイルレイヤを非同期にフェッチして描画する11。京都一周トレイルのような微細な地形変化や等高線を伴う領域では、単なる市街地マップ（標準のOpenStreetMap等）ではなく、国土地理院のタイルデータ、あるいはハイキングに特化したTopoマッププロバイダをエンドポイントに設定することが望ましい11。

| Leaflet実装コンポーネント | APIメソッドおよびプロパティ | 目的と技術的効果 |
| :---- | :---- | :---- |
| マップインスタンスの初期化 | L.map('map').setView(\[Lat, Lng\], Zoom) | DOM要素とのバインディングおよび起動時の初期視点の固定11。 |
| ズームレベルの制約設定 | minZoom: 13, maxZoom: 18 | 広域すぎる表示の防止、およびタイルが存在しないレベルへの過剰拡大による404エラーの抑止13。 |
| ベースレイヤの読み込み | L.tileLayer(urlTemplate, options) | XYZ方式での地図画像の動的フェッチ、キャッシュ管理、および著作権表記（attribution）の実装11。 |
| モバイルインタラクション | デフォルト有効（イナーシャ、ピンチズーム） | タッチデバイスにおける直感的なパン操作（慣性スクロール）とダブルタップズームの提供10。 |

また、ハイカーの移動に伴い生成される座標データは、リアルタイムで地図上にポリライン（軌跡）として描画される。あらかじめ策定した15kmのルート（松尾山〜烏ヶ岳〜沓掛山）をベースレイヤとして赤色の破線で静的に表示しておき、実際の現在地から生成される実測軌跡を青色の実線で上書き描画していくアーキテクチャを採用することで、計画に対する進行遅れやルートからの逸脱を直感的に視覚化することが可能となる。

## **5\. HTML5 Geolocation APIとバックグラウンド測位の高度な制御戦略**

スマートフォンに内蔵されたGPSハードウェアから正確な位置情報を取得し、Webアプリケーション上で同期的にハンドリングするためには、HTML5 Geolocation APIの深い理解と、モバイルOSに起因する厳しい制約に対するエンジニアリング上の対策が求められる。

### **5.1 高精度非同期トラッキング（watchPosition）のアルゴリズム**

単発の位置取得機能である getCurrentPosition ではなく、デバイスの移動に伴いイベント駆動型で座標を連続的に取得・監視する watchPosition メソッドを実装する14。京都の西山エリアのような樹林帯や複雑な山岳地形においては、Wi-Fiアクセスポイントや携帯基地局の三角測量に基づく大まかな位置情報（低精度なネットワークロケーション）では、数十メートルから数百メートルの誤差が生じ、致命的なルートロストを招く危険性がある。

したがって、GPS衛星からの直接的な測位データを強制的に取得するために、第3引数である PositionOptions オブジェクトにおいて enableHighAccuracy: true を明示的に設定することが必須条件となる14。さらに、OSが保持している古い過去のキャッシュデータを無効化し、常に最新の測位データを要求するために maximumAge: 0 を指定する14。

JavaScript

const trackingOptions \= {  
  enableHighAccuracy: true,  
  timeout: 15000,  
  maximumAge: 0  
};

const watchId \= navigator.geolocation.watchPosition(  
  (position) \=\> {  
    const lat \= position.coords.latitude;  
    const lng \= position.coords.longitude;  
    // Leafletマップ上のマーカーとポリラインを更新するロジック  
  },  
  (error) \=\> {  
    console.warn(\`Geolocation Error: ${error.code} \- ${error.message}\`);  
    // エラーハンドリングとユーザーへのフォールバック通知  
  },  
  trackingOptions  
);

### **5.2 モバイルブラウザにおけるバックグラウンド実行制約への対応**

Web技術を用いてネイティブアプリ同等のトラッキングアプリを開発する際における最大の技術的障壁は、モバイルOS（iOSおよびAndroid）による厳格なバッテリー管理およびリソース制限ポリシーである。iOSのSafariやAndroidのChromeにおいて、ユーザーが別のタブを開く、ブラウザアプリをバックグラウンドに移行する、あるいはデバイスの画面がロック（スリープ）状態になると、セキュリティと省電力の観点からJavaScriptのメインスレッド実行が一時停止される19。この状態に陥ると、Geolocation APIによる watchPosition のコールバックイベントの発火が完全に停止する19。

画面が消灯した状態で山道を数十分歩行した場合、その間の軌跡データは一切取得されず、次に画面を点灯させた瞬間に現在地がワープするように直線で結ばれてしまう現象が発生する。ネイティブアプリであればOSレベルのバックグラウンドタスク権限を取得することでこの制約を回避できるが21、ブラウザ上のWebアプリケーション単体ではこれを完全に透過的に処理することは不可能に近い。

### **5.3 Screen Wake Lock APIによるスリープ抑止メカニズム**

上記の問題に対する現行のWeb標準における最も強力かつ唯一の解決策は、トラッキング実行中においてデバイスの画面消灯（スリープ）をプログラム側から物理的に抑止することである。これを実現するのが、近年主要ブラウザでの実装が進んでいる「Screen Wake Lock API」である22。

navigator.wakeLock.request('screen') メソッドを非同期関数として呼び出すことで、OSに対して画面を常にオンに保つよう要求し、ロックの制御権を持つ WakeLockSentinel オブジェクトを取得する22。これにより、ブラウザがフォアグラウンドで動作し続けることがシステムレベルで保証され、結果として watchPosition による高精度なGPS測位が途切れることなく継続される24。

JavaScript

let wakeLockSentinel \= null;

const requestWakeLock \= async () \=\> {  
  if ('wakeLock' in navigator) {  
    try {  
      wakeLockSentinel \= await navigator.wakeLock.request('screen');  
      wakeLockSentinel.addEventListener('release', () \=\> {  
        console.log('Screen Wake Lock was released by the OS.');  
      });  
      console.log('Screen Wake Lock is active.');  
    } catch (err) {  
      console.error(\`Wake Lock failed: ${err.name}, ${err.message}\`);  
    }  
  }  
};

ただし、ユーザーが意図的に別のアプリに切り替えたり、ホーム画面に戻ったりした場合は、システムによってWake Lockが自動的に解除されてしまう。そのため、Page Visibility APIを併用し、アプリが再びフォアグラウンドに戻った（visibilitychange イベント発火時）タイミングで、Wake Lockを自動的に再取得する自己修復ロジックを組み込む設計が不可欠である26。

このアーキテクチャはディスプレイを常時点灯させるため、デバイスのバッテリー消費量が飛躍的に増大するというトレードオフを伴う。コース定数25.5の過酷なルート（想定行動時間約6.8時間）を踏破する間、常時画面をオンに維持するためには、大容量のモバイルバッテリーの携行が必須要件となることをユーザーに明示する必要がある。

## **6\. 動的インフォグラフィックとデータビジュアライゼーションの実装要件**

現在時刻、GPS情報、標高データ、および運動強度に基づく生体推計情報を同期させ、視覚的に優れたインフォグラフィックとして重畳表示するフロントエンドの要件を定義する。

### **6.1 時空間データの同期とDOMへのリアルタイム反映**

アプリケーション内で requestAnimationFrame または setInterval を利用してローカルの現在時刻（Date.now()）を取得し、画面上のUIレイヤに秒単位で描画する。同時に、watchPosition から非同期に返却される GeolocationPosition オブジェクト内の timestamp プロパティと coords プロパティ（緯度、経度、高度、速度など）を抽出し、アプリケーションの全体状態（State）を更新する14。

UIレイヤは、地図上にフロートする半透明のオーバーレイコンポーネントとしてCSSで絶対配置するか、Leafletの Custom Control クラスを拡張して実装する。このダッシュボード領域には、以下のデータを同期的に表示する。

* **経過時間とペース**: トレッキング開始からの経過時間を表示し、coords.speed（メートル/秒）を基にハイキングペース（分/キロメートル）に変換して提示する18。  
* **動的消費カロリー推計**: これまでの累積標高と歩行距離から動的に現在のコース定数を逆算し、事前の体重設定値（例えば65kg）を乗じて、リアルタイムの推定消費カロリーをプログレスバー等を用いてインフォグラフィックとして表示する。

### **6.2 標高プロファイルの生成とChart.jsの統合**

登山における中核的な視覚要素として、ルート全体の標高断面図（エレベーションプロファイル）と現在位置のマッピングが存在する。これを実装するためには、ベースとなる計画ルートのGPXファイルをクライアントサイドでパースし、距離（X軸）と標高（Y軸）の2次元配列データを生成する必要がある27。

技術選定としては、leaflet-gpx プラグインを用いてGPXデータをLeafletレイヤに変換しつつ、その際に内部で抽出される距離・標高ベクトルデータを Chart.js に渡し、リッチな折れ線グラフ（ラインチャート）として描画する手法が最も堅牢かつ拡張性が高い27。あるいは、単一のライブラリで完結させるために leaflet-elevation プラグインを導入することで、インタラクティブな標高グラフと地図上のマーカーを完全に同期させることも可能である28。

ハイカーが移動して新しいGPS座標が取得されるたびに、計画ルートのポリライン上で最も近いポイントを幾何学的に計算し、Chart.jsのグラフ上に「現在地インジケータ（垂直のハイライト線など）」を動的に移動させる処理を組み込む。これにより、ユーザーは「あとどれくらいの急登が連続するか」を視覚的に瞬時に把握でき、ペース配分の最適化と精神的な疲労マネジメントが可能となる。

### **6.3 SVGオーバーレイによる動的空間マッピング**

データ可視化のさらなる高度なアプローチとして、Leafletの L.svgOverlay メソッドを活用し、地図の特定の境界矩形（LatLngBounds）に対してSVGベースのインフォグラフィックを直接重畳する手法が存在する13。

この手法では、静的な画像マップ（ImageOverlay）とは異なり、SVGのDOMツリー内の個々の要素（テキストノード、パス、ポリゴン等）に対してJavaScriptからリアルタイムにアクセスし、属性値やスタイルを動的に変更することが可能である13。例えば、西山ルート全体の特定の山頂（松尾山、嵐山、烏ヶ岳、沓掛山）の位置にSVGグループ要素を配置し、ユーザーのGPS座標がその半径50m以内に接近した際に、SVGのアニメーションをトリガーしてチェックポイント通過の視覚エフェクトを発生させるといった、高度な空間的ゲーミフィケーション要素を取り入れることができる。

JavaScript

const svgElement \= document.createElementNS('http://www.w3.org/2000/svg', 'svg');  
svgElement.setAttribute('viewBox', '0 0 200 200');  
// 内部パス要素の動的構築

const routeBounds \= \[\[34.97, 135.65\], \[35.02, 135.69\]\]; // 西山南部エリアのバウンディングボックス  
const svgOverlay \= L.svgOverlay(svgElement, routeBounds, {  
    opacity: 0.8,  
    interactive: true  
}).addTo(map);

このように、SVGの論理座標とLeafletの地理座標系を同期させることで、地図のズームやパン操作にシームレスに追従しながらも、解像度非依存のシャープでインタラクティブなインフォグラフィックを動的に維持することが可能となる。

## **7\. 総括とシステム展望**

京都一周トレイル西山コースにおいて、初心者からのステップアップとして最適な「コース定数20〜30」を実現するためには、一般的な嵐山周辺の短距離周回ルート（定数約11.8）では生理学的な運動負荷が不足しており、沓掛山を経由して上桂に至る全長約15km、累積標高約800m超の縦走ルート（定数約25.5）への拡張が数理学的に最も妥当であると推量される。このルート計画は、歩行者に対して長時間にわたる有酸素運動と適切な疲労感を提供し、達成感と安全性のバランスを高度に満たすものである。

また、このトレッキング体験をデジタル面から拡張するリアルタイムGPS同期型インフォグラフィックマップの開発においては、HTML5とLeaflet.jsを中核とした堅牢なSPAアーキテクチャが要請される。特にモバイルブラウザ特有のバックグラウンド実行制限を打破するために「Screen Wake Lock API」による積極的なスリープ抑止ロジックの導入が必須であり、それに伴うバッテリー消費増大への物理的な対策（外部電源の携行）が前提となる。加えて、watchPosition によるイベント駆動型の高精度測位データと、Chart.jsやSVGオーバーレイによる非同期データバインディングを統合することで、単なる現在地確認ツールを超えた、ハイカーの生体状態とルートの地形情報を視覚的に融合する高度なナビゲーションダッシュボードが実現される。これらの要件を厳密に実装することにより、過酷な自然環境下における安全性の向上と、革新的なインタラクティブ・トレイル体験の両立が達成される。

#### **引用文献**

1. コース定数とは？ \- YAMAP ヘルプセンター, 3月 29, 2026にアクセス、 [https://help.yamap.com/hc/ja/articles/900000967903-%E3%82%B3%E3%83%BC%E3%82%B9%E5%AE%9A%E6%95%B0%E3%81%A8%E3%81%AF](https://help.yamap.com/hc/ja/articles/900000967903-%E3%82%B3%E3%83%BC%E3%82%B9%E5%AE%9A%E6%95%B0%E3%81%A8%E3%81%AF)  
2. 3月 29, 2026にアクセス、 [https://note.com/teizanhiker/n/n4974b19201ec\#:\~:text=%E3%82%B3%E3%83%BC%E3%82%B9%E5%AE%9A%E6%95%B0%E3%81%AB%E3%82%88%E3%82%8B%E9%9B%A3%E6%98%93%E5%BA%A6,%E5%90%91%E3%81%91%E3%80%81%E5%88%9D%E5%BF%83%E8%80%85%E3%81%AB%E3%81%AF%E5%8E%B3%E3%81%97%E3%81%84](https://note.com/teizanhiker/n/n4974b19201ec#:~:text=%E3%82%B3%E3%83%BC%E3%82%B9%E5%AE%9A%E6%95%B0%E3%81%AB%E3%82%88%E3%82%8B%E9%9B%A3%E6%98%93%E5%BA%A6,%E5%90%91%E3%81%91%E3%80%81%E5%88%9D%E5%BF%83%E8%80%85%E3%81%AB%E3%81%AF%E5%8E%B3%E3%81%97%E3%81%84)  
3. コース定数と、予想消費カロリー／水分 \- 山と溪谷オンライン, 3月 29, 2026にアクセス、 [https://www.yamakei-online.com/iframe/help.php?kind=course\_const](https://www.yamakei-online.com/iframe/help.php?kind=course_const)  
4. trail\_map.pdf  
5. 松尾山 嵐山 烏ヶ岳 大悲閣千光寺 \- 山と溪谷オンライン, 3月 29, 2026にアクセス、 [https://www.yamakei-online.com/cl\_record/detail.php?id=167150](https://www.yamakei-online.com/cl_record/detail.php?id=167150)  
6. 京都西山（松尾山～嵐山～烏ヶ岳～沓掛山） \- 2020年01月06日 \[登山・山行記録\]-ヤマレコ, 3月 29, 2026にアクセス、 [https://www.yamareco.com/modules/yamareco/detail-2172426.html](https://www.yamareco.com/modules/yamareco/detail-2172426.html)  
7. 上桂駅-沓掛山登山口-沓掛山-新烏ヶ岳-烏ヶ岳-嵐山-松尾 縦走コースの地図・登山ルート・登山口情報 | YAMAP / ヤマップ, 3月 29, 2026にアクセス、 [https://yamap.com/model-courses/25938](https://yamap.com/model-courses/25938)  
8. 山行記録: 松尾山～嵐山～烏ヶ岳～山上ヶ峰～西芳寺谷林道～沓掛山 \- ヤマレコ, 3月 29, 2026にアクセス、 [https://www.yamareco.com/modules/yamareco/detail-5849165.html](https://www.yamareco.com/modules/yamareco/detail-5849165.html)  
9. Leaflet on Mobile \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/examples/mobile/](https://leafletjs.com/examples/mobile/)  
10. Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/](https://leafletjs.com/)  
11. Quick Start Guide \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/examples/quick-start/](https://leafletjs.com/examples/quick-start/)  
12. 【wordpress】登山ガイドが実際にカスタマイズした！登山のためのwordpressカスタマイズまとめ, 3月 29, 2026にアクセス、 [https://guide-somabito.com/20211212customize/](https://guide-somabito.com/20211212customize/)  
13. Documentation \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/reference.html](https://leafletjs.com/reference.html)  
14. Using the Geolocation API \- MDN Web Docs, 3月 29, 2026にアクセス、 [https://developer.mozilla.org/en-US/docs/Web/API/Geolocation\_API/Using\_the\_Geolocation\_API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API/Using_the_Geolocation_API)  
15. Geolocation \- W3C on GitHub, 3月 29, 2026にアクセス、 [https://w3c.github.io/geolocation-api/](https://w3c.github.io/geolocation-api/)  
16. Geolocation API \- MDN Web Docs \- Mozilla, 3月 29, 2026にアクセス、 [https://developer.mozilla.org/en-US/docs/Web/API/Geolocation\_API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)  
17. Geolocation: watchPosition() method \- Web APIs \- MDN Web Docs, 3月 29, 2026にアクセス、 [https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)  
18. Real Examples of Using the Geolocation API for Live Tracking \- Skill Stuff, 3月 29, 2026にアクセス、 [https://skillstuff.com/real-examples-of-using-the-geolocation-api-for-live-tracking/](https://skillstuff.com/real-examples-of-using-the-geolocation-api-for-live-tracking/)  
19. Solved: running watchposition in background \- Experts Exchange, 3月 29, 2026にアクセス、 [https://www.experts-exchange.com/questions/28668371/running-watchposition-in-background.html](https://www.experts-exchange.com/questions/28668371/running-watchposition-in-background.html)  
20. Using geolocation.watchPosition() in mobile safari using location services \- Stack Overflow, 3月 29, 2026にアクセス、 [https://stackoverflow.com/questions/40325654/using-geolocation-watchposition-in-mobile-safari-using-location-services](https://stackoverflow.com/questions/40325654/using-geolocation-watchposition-in-mobile-safari-using-location-services)  
21. How Accurate is HTML5 Geolocation, really? Part 2: Mobile Web \- by Andy Gup, 3月 29, 2026にアクセス、 [https://www.andygup.net/how-accurate-is-html5-geolocation-really-part-2-mobile-web/](https://www.andygup.net/how-accurate-is-html5-geolocation-really-part-2-mobile-web/)  
22. WakeLock \- Web APIs | MDN, 3月 29, 2026にアクセス、 [https://developer.mozilla.org/en-US/docs/Web/API/WakeLock](https://developer.mozilla.org/en-US/docs/Web/API/WakeLock)  
23. Screen Wake Lock API \- MDN Web Docs \- Mozilla, 3月 29, 2026にアクセス、 [https://developer.mozilla.org/en-US/docs/Web/API/Screen\_Wake\_Lock\_API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)  
24. Stay awake with the Screen Wake Lock API | Capabilities \- Chrome for Developers, 3月 29, 2026にアクセス、 [https://developer.chrome.com/docs/capabilities/web-apis/wake-lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock)  
25. Experimenting with the Wake Lock API | by Thomas Steiner | Dev Channel \- Medium, 3月 29, 2026にアクセス、 [https://medium.com/dev-channel/experimenting-with-the-wake-lock-api-b6f42e0a089f](https://medium.com/dev-channel/experimenting-with-the-wake-lock-api-b6f42e0a089f)  
26. Web app fetching background geolocation using service worker and push notification, 3月 29, 2026にアクセス、 [https://stackoverflow.com/questions/52464557/web-app-fetching-background-geolocation-using-service-worker-and-push-notificati](https://stackoverflow.com/questions/52464557/web-app-fetching-background-geolocation-using-service-worker-and-push-notificati)  
27. mpetazzoni/leaflet-gpx: A GPX track plugin for Leaflet.js \- GitHub, 3月 29, 2026にアクセス、 [https://github.com/mpetazzoni/leaflet-gpx](https://github.com/mpetazzoni/leaflet-gpx)  
28. leaflet-elevation.js \- raruto.github.io, 3月 29, 2026にアクセス、 [https://raruto.github.io/leaflet-elevation/](https://raruto.github.io/leaflet-elevation/)  
29. How to Create a Route Elevation Profile with Chart.js and Geoapify Routing API, 3月 29, 2026にアクセス、 [https://dev.to/geoapify-maps-api/how-to-create-a-route-elevation-profile-with-chartjs-and-geoapify-routing-api-27k3](https://dev.to/geoapify-maps-api/how-to-create-a-route-elevation-profile-with-chartjs-and-geoapify-routing-api-27k3)  
30. Plugins \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/plugins.html](https://leafletjs.com/plugins.html)  
31. Overlays \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/examples/overlays/](https://leafletjs.com/examples/overlays/)  
32. Tutorials \- Leaflet \- a JavaScript library for interactive maps, 3月 29, 2026にアクセス、 [https://leafletjs.com/examples.html](https://leafletjs.com/examples.html)  
33. SVG Overlay Tutorial \- Leaflet, 3月 29, 2026にアクセス、 [https://leafletjs.com/examples/overlays/example-svg.html](https://leafletjs.com/examples/overlays/example-svg.html)  
34. Display of SVG on Leaflet map \- Stack Overflow, 3月 29, 2026にアクセス、 [https://stackoverflow.com/questions/53170777/display-of-svg-on-leaflet-map](https://stackoverflow.com/questions/53170777/display-of-svg-on-leaflet-map)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAYCAYAAAAlBadpAAABDklEQVR4Xu3TP0tCURjH8UdCMBJChDBQlGwp30EgSDQ0BrW7uuqkItHi2NDUElJtvoAImqIgh95BTUHoHtFQoH2f7tFOp+u9i6M/+MDhee7hcP5ckXlmmjhKOMAGFkx9CWkz/pdN9PCOLmq4xA0KuMbO5GuTKFr4RB2Lf9tSxBtexVlZJ57iC/t2w0oMV4aOJ6lghAYidsPJBZp2YR19PCNjN3xyJs5+j8RbtW0Xp2RZvC3+RK/jFkPxOcGwrOIFA6w5vdCMJysdB0UPdcsuJPAo4ZOT6GDFbRyLt+ddt2GiV6evzPf+s3jCHVJOT1/ZIaoScP85POAD5yjjBPfYloCJ4+gHOewZefn9k+Yh3wXlKf2EjsadAAAAAElFTkSuQmCC>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAYCAYAAADKx8xXAAAAuklEQVR4XmNgGAW0A05AfBeIHxGJXUCaGIF4ChCvBGIFKB8E5gDxPyD2gPKZgdgeiB8AsSlIQByIVwGxGFQBCAgC8WkGiCJpJHEeIF4MxDIgDsjaQiRJENAH4k9AvAaIWZDEQQZOAmJeECcUiNWQJEEgGoj/A3E5mrgwEKcxILyDAUD++w3ENugS+AAu/xEExkD8lQHTfwQBLv/hBSBPz2cYtP4DxeE5IH7HAPEbDH8B4usMEMNGASkAADZTK/tpRsvyAAAAAElFTkSuQmCC>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAXCAYAAADtNKTnAAAA8klEQVR4Xu3SvWrCYBTG8SO0oBRxEezgLBS6iKiLDoXORbwJ76c4iUs3BxehhQ5Oeg3iqlIQhNbJQhVb/8lpYjxo4yQUfOAHIU/yvrwfIuf8n9xhip+AD8x+n5d4Rsb74a80sULJvE+jgzkKpttJHH0MkDSdkxSGeEXMdH5u8I42Lkzn5Un0G+fbvXkQXX/NFoE4g3wibwsvj7J/P7xcoYsFcqZzc8xS7vGNF0RN5yZsKRHURQepms5P2FKyosfbwKXp3IQd7TV6ovuRMJ2fW9FZ7H44M1YwQksODFDGWLbXfI03TESv+5foVS+K7sk5p8oGNSE1XA7VzGcAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAXCAYAAADUUxW8AAAAjUlEQVR4XmNgGAWjgATADcTi6IJIgBGIpYCYGV0CBESBeBUQm6BLMEA0JgDxZCBmRZVCABkg3gHEZkhiRGmEAWQDSNIIAzADpjCQqBEEQDYWAfFrILZCk8MLQBpzGCA2ygHxegbUMMAJkDXCnCrBQIQBII1ZQDyBAdOPBA3QAuImBkyNMCAExF1QesQCAJVwESzUa4sLAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAiCAYAAADiWIUQAAAK/ElEQVR4Xu2cCcglRxHHSzzwPrJiNCp5SoyKSgwewaCyisYLo6hRWUXFA0XUqMGDoMYrSLxQA966GyF4JYp4YCTogkGEBDVgiERlo0RFJYKgIAGP/tFTTn31dc/Me98Td+H/g+Kb6Zk3U11VXV3TM7tmQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIcexzmyJ/K/L+IucWeXWRS4vcOp60R87IDYGbFflYkacXuWU6tilnF3lXkZPzgQDnvL3IPfKBDbl/kU8XOZAPBJbotS5ck/veMR8YOK3Ix4uclQ/sAWLmJamN+6MHNu2BjYizKRutC9fjvug0BXH2qrDvupwT2lZF7lXk5kVOse2MAfSiv9xrCrdfz4/r4tebi+8lduEa5AT+utw+HN8U7Ptgq/bG7qsdR3dzMDfsgVNtOi+5HV6Y2vEldkXfbXKnIg/JjQMtn6xs+7FKLHi+4LotWrq4H/nb8iM5irllW7HttPzXyk0RjuM/+kB/hThm+HORy1PbEwbZBgz+pxZ5Sz4wwCD/+rDNQPpOOLYpFH9nFrlLkSuLPHDnYbtFkc8Of+F8m5/sn5IbEvcu8oJhm/u+Jhxz5vTahN8Nf48v8pt4YIB7fG/YRj90mOKDuaHBM4p8yXbeD1teEva/G7adJTZal1+GbWw6xfdtjEPsRYyTsE+yeh30e1iRXxT5mc0XOkDinwO96C9ca/XeGfz4PBv9uOTeUxDf7g/iu+UPZ4ldeJi6ymp/kcNWC4y9QtH38yKHrOaKKTj+99zYYEkM0x+u1ctL2MELMmzxzmEbu7r/sOucDZbo4vzFavxlej5ZN1aX6PLHIo8etonDJ4dj0NPF/fhr2+nHB9mYozjWylGbwD1a80orN2UoHJ2fhm0hjmruZnUQrVI7iWCbT49cLw8sh8T5k7B/UdiO5EmOhHFCanM+VORlRe5Q5IdWnz4j9y3yh7D/LGsnygh6TkEh4tdAt8Pjof8ypxcclxusPum2ngQpkq4Ztjn+0nDM4Wn46mGbfjLhTHFhbuiAn2JSxKbRx62JtWWjvEpDe6uvt8sNA/E+F9vu6zlc8wM26ogexD5xxbF/Wy3K5+Ig04tXh0ItnsNKNkV7xP14Vxv96A8Tkdbq877cMEB8e1/xe8sfsNQub7DxIY4i5avDdoueTi3w15Jig3t+xvr9iCyN4amCDTvcL+z7uLnRxhgjJ7hNeizVhf5RCLfir+eT1rlTLNGFMe3+IEflFc2eLj0/YjfPUYz/Vo4CclxrhbA1Dhx0afkv56bMBWFbBZs4ZrjB6kSbaU0Me6E3sIB7kahuspogmFxaUEA+ctgmUZB85vRkAv9tbrSaaEk0cb+nnzNXsJEkYgKdmlh6ejmXFTlx2H5HkTeFYxEmi28VeWORL9p0kf0kq0/wczZbktQhJ8Vsw2hfp2Wj1qRDAeF9ZoXw2+FYJto5X9+Jk2HLzxRVrCxQ3HLOF4r8qsh58aQOcwUb14vnoG/+jfvxUzbtR1Yko398ZboF9ve+5nh31rFL5JPWjiMmwlcM218r8uNw7NlhO8JE/2GrqzDfSMciPOxwz6lx5SyN4amCzYsRBL3YB34TC7ZtPACR1+gfurTiN7KXWJ3ThX7Fgu3wsN8j6uJ+ZJUt+vFfNuaoK6wd2xT/97HqX+akNw/txOehYbtFL25zbspcZ9Vm59uYZ4U46mkl8f8FvYEFDFKW6k+3qs9UQmaw82pnLvE4Dyjye9u9OkPymCvY0Ct+r/OisM3KZITrX267i5EePb0iD7W6ouATRQv0jsUMybEHT7Dvs/aKQOzn59J+7/45KWLTuYKtZaPeBIX96f9UQsV+Swo2n+x7cXitjQVILER4dfKosO9E+zDZxP28wsfqw1zB5n70FQb82PIT4I+vFPlmPpBYUrCtYxfn+VZXAlusckPh8YPk6zj0x2PsETa+eoywuue0xhW/n4rhHnMFG58SeF5i/AOF52nDNvbJvlxXF84/a9heUrCtE6tzuuQVreNtvYIt6tLzI7bzHEX/Wjkqjxl4pdVXrVP04hafTOnNwgD+xP8/SseEOGppJXF4b27YI72BBXzs/INh+61F/mn978lICBQGJNElcP7FtvODasgTWKtg4x6sPriQvH37o+E8hySRi5EePb0iJEJePUyRi4GePx0SKU/AueCM/eSbmLh/53BeJCfFbMOWLi0bTU1QFLU+CfSYK9iYDFbDdisOeYo/O7U5nEu8RSgSo32OpH1eeUe4Z/RRq2Br+THrGeGbJVZWppgr2Da1Cw9MU6+pHm51ZS1/XJ6LgxboQVGfobB0WuOKeJ6K4R5TBdsTbSwYDtj47SHxyOoMsU9RkX+/ri6n2lj0cK0cv5GeT6AVq3O6EHeRdVbYpnRxPzJWiDuPbXTMcQicR1F+yHaP91PSfqQVt5BzU4S5xX/DAkBLHyGOSljOzsXRyvof0j6tyHMmpEceWKz2rIbtwzZ+iA4UFa0neAbyhVaT291tfD2a4V6xEGDw+of29Ivr3LPI9UMbkHh59TYFk94UfJfkqyJMTv5Uib6+itHTKxNfCXKdE8OxCP25JOzHp9d9w1/u4wmTe99o033FxkvISRGbxv5wH8d1admoNZGzunjZsD31Shgo8J14vVXYdnIcfsTGV/A8pBB79MkL2nNt9/dmGbdtDybBqNdNNtrgBKvx6H70Qqi3wuYrzODjocf1NvqD+HZ/rGwzuzhTExz/6s59ja68GnvMIKxqtMB+FEfAfQ4O2z5uMq2CLTNll0irYIvjJnKV1XHzWhvHI7r2cqWzVBfIBZvHB7R8sm6sLtEl5odrbIyhOV1afuR8infPUfSvtcIW8/8Bq/MSNj7Pph9Mctw6OTeB+4zfxM+AsJsQxwQUTv+w+uEl/5UHAzE/Ge8VVpFI8gjfUJFgKH64LwOagpFvYl5n9ans8/Vnu3h32j/O+v9NAk+OF1idKP86tDFx8i9QfeCSaL9s9X5XDG1TzBVscMRq4XqljZPN6238fqelV+Zxtvsp86Qit0ptDonxxVa/ffK+MVn6SgX9ZPscqx+8b2OCYfJ1n94Q2rEvfcSm/q2K6+L3xUZ8oxJtFLmt7S5QidPTU5vDig7Xw+7Y1iG+/FsYIO4o7tD5T1YTt/cBQR++yeHeFMyslC15XZIn9hafsLqK/B6rxSgQj9fZzsmff3wT/ZihrxHi5LmpzcHe7g/i2/2xqV0c2rYJMXCp1Yk5Fvlx3AAFLPpxf/zihUqLJTHM6q330YvJGKvEHPq8zeprbx4SgaLo5UO7vyadYokuQP/QBV/QvxgfPZ9wbJ1YXaILhdgRqzmFOYEYW6KL+5HfRT+yenZwaL/a+rG9Lq15BXq5iQclBz0oEinWlvhQiKMGnrb3D/L/5Jk2/83COuwv8lhrFwUOyQchOc+xpGAjOc31Y7/N67UOJFSKFa7ZY2XzejlLknoP7Igu2LQHNjrDlumyFK5H/7YFtqQfS+JiScGGj062aR8tOWdd3B9L+rEUX0XZJvR7v+1e+duUvcRwZJ/VcY9+EdqIuSVsS5ce68TqUl283+uCndAl+9Fz1LZy3l7xcbHUh0IIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIcT6/AdcplTKmY77EgAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,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>

[image8]: <data:image/png;base64,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>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE0AAAAXCAYAAABOHMIhAAADfUlEQVR4Xu2XWchNYRSGX6EImccMf5IihUwRpURJSoZI4kchueEvszLkgmRWkjJdyBQuFFHOnankgpSSiFwIpUjJ8L7W/vrXGfbZex913Oy3ns45356+9X5rrW8fIFeuXLly5cpVu3qTbeQE2UEGFR/+q3lkAmlPWpAeZBEZ4U+qoDZkMRkWfW9J+pIVpKH5tLqpLVkIi3U3bC5eqeIcS26TSWQ4uUF+kybYRVIrcjEa91wiHaNz4tSJPED5tftIa3dePTSEPCGbYGbJoIcwY6RUccr1a2QZLAOkrrAbfSWjojHpJHlK3pDLZAaar6kmrZgWQte+JKfJODQvSL0kYzQHGaZntyN3UEOcKsvX5Assy4I2wxxe58aOoPjmaSXTzsCelVUKrGfpoJOC74N0i7eBfIRlW9AUshGWPEGJcao8DpFbKA5KD5Bp+gxKvFmM/sW07rByGV16AGZYI2xeSWWu0rpPHsEqSSjzKpldU5yqa6XlTzLZjR8lB8hj8pbcIyPd8TjJtAtkPyzt35HrSL8JqPfchPXeoCyGScouZZmMO0a2wK59hvKNrKY41W9U59pd/IROwfpBWB3tKJ9QHEwlyTRl8nxYsGIXeUEGuPOqyRuX1TBJmaOYfpHZ0Zjus4c8R/EOmjlOpbGa4zlYP/HqgOJ01oO0Eudh2RknTU7X+sY/hnwj291YkoJxyoQshknBNGVWNzc+E9aGVrqxTHFqEsdhZeQbY5zCJqIdsVqzrqQQhBaodHHiJNO1MX2AvUdlkTY5bXYFWOYHBdPUc+MUG2cwzKel+sC06PtSWGqvin5L4WaiWpNXCfwgU91YMK2A4iDiJMPWwDKsP7mKKuVSQQpWQRdQ3bTUcWpCTWRt9D1IKRvqP+ym/mYhbQtonogMb4C9+QdpQtpUvGmhPNU//DMryRsWSrIXshmnslJ5affs7MZLyzNVnJpQIywAHdALXUDNb6JOosbDeonvI2rs38kcN7Yc9lBf/wtg70LBHH0qoz8jOWidu5ocRHkPy2qcFk2lHV4ndO/SjSBVnCH1/F+GwHsyMDovZONdmDGHYVu4AvKZopXTA9a7cU1A2/wVsoSchV07PTpeTUPJTpQbFtSF7I0+k6R7bCWvYP97lblKFP8OmDbOTOpHZsF6XdJ/Ti89cDCZC3v38+Vbb/kY4jahWuPMlSvX/9MfZYjQdX+kOAEAAAAASUVORK5CYII=>