# Source data attribution — `data/courses/raw/`

This directory holds the upstream geometry data this project derives its
course JSONs from.

## OpenStreetMap (`*.geojson`, gitignored)

Files like `higashiyama.geojson`, `kitayama-east.geojson`, `kitayama-west.geojson`
are produced by `tools/fetch_kyoto_trail.js` from the OSM Overpass API and are
**not committed** (they are regenerable). The data inside them is © OpenStreetMap
contributors, distributed under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/).

## ibuki.run (`ibuki-*.gpx`, committed — Phase 8)

The two `.gpx` files committed here are GPS tracks downloaded from
[ibuki.run](https://ibuki.run/), the GPX-sharing service operated by OND Inc.

| File | Source URL | Recorded distance | Use |
|---|---|---|---|
| `ibuki-fullloop.gpx` | https://ibuki.run/c/8961576220845321440/ | 69.27 km | Patches the OSM-mapping gap (北山西部 marker 70-90, ~4 km) so kitayama-west covers the full ~19.5 km route. |
| `ibuki-keihoku.gpx` | https://ibuki.run/c/8960902124485477537/ | 18.80 km | Sole geometry source for the 京北 course (no OSM hiking relation exists for this area). |

### License

ibuki.run's [利用規約 (Terms of Service) §6.3](https://ibuki.run/terms) treats
**coordinate data uploaded by users as CC0 1.0 Universal** (public domain
dedication, no attribution required, freely redistributable, including for
commercial use).

This project nevertheless credits the source here as good practice. The CC0
license applies to coordinate values only — the surrounding metadata
(track names, timestamps, ibuki.run UI text) is not redistributed by this
project.

> "ユーザーがアップロードしたコンテンツのうち、座標情報については CC0 1.0 Universal
> として取り扱われ、何人もこれを自由に利用、複製、改変、頒布することができます。"
> — ibuki.run 利用規約 第6条第3項

## How regeneration works

```bash
# OSM courses (re-fetch + rebuild)
node tools/fetch_kyoto_trail.js
node tools/build_courses.js

# ibuki-derived courses (Phase 8)
#   - keihoku.json (full)
#   - kitayama-west.json (gap fill applied on top of OSM build)
node tools/build_courses_ibuki.js
```
