#!/usr/bin/env bash
# Builds public/data/ from the bcn-property-finder datasets:
#   noise-day.pmtiles, noise-night.pmtiles  Barcelona Strategic Noise Map 2022 rasters (2 m), Ld 7–21 h / Ln 23–7 h,
#                                           coloured with the classes of src/palette.json (one scale for day and night),
#                                           z11–15 (the map overzooms with linear
#                                           resampling; ZOOM_LEVEL_STRATEGY=UPPER gives z16 at ~4× the size).
#                                           NEAREST: GDAL’s OpenCL bilinear warp kernel fails on macOS.
#   facades.pmtiles (z14)                   layer f: noise points 3 m outside each facade (building b, side, dir, ld, ln)
#                                           layer h: residential building footprints (Catastro ref b). Mapbox Standard splits
#                                           buildings into parts by height: a clicked part belongs to the home whose
#                                           footprint holds the part's centroid
# Needs GDAL ≥ 3.1, tippecanoe ≥ 2.17, python3. SRC = bcn-property-finder/data, a sibling checkout by default (raw rasters + buildings/exposure.gpkg).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${SRC:-../bcn-property-finder/data}"
OUT=public/data
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

[ -x .venv/bin/pmtiles-convert ] || { python3 -m venv .venv && .venv/bin/pip install -q pmtiles; }

# gdaldem colour file: each class is a flat band from its lower break to just below the next; 0 = inside buildings
python3 - "$TMP/palette.txt" <<'EOF'
import json, sys
p = json.load(open('src/palette.json'))
a = round(p['alpha'] * 255)
edges = [0.01] + p['breaks'] + [200]
with open(sys.argv[1], 'w') as f:
    f.write('nv 0 0 0 0\n0 0 0 0 0\n')
    for lo, hi, c in zip(edges, edges[1:], p['colors']):
        r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5))
        f.write(f'{lo} {r} {g} {b} {a}\n{hi - 0.01} {r} {g} {b} {a}\n')
EOF

for p in day:Dia night:Nit; do
  name=${p%%:*} period=${p#*:}
  echo "Noise raster, $name…"
  gdaldem color-relief -q -alpha "$SRC/noise/2022_Raster_Total_${period}_Mapa_Estrategic_Soroll_BCN.gpkg" "$TMP/palette.txt" "$TMP/$name.tif"
  gdal_translate -q -of MBTiles -co TILE_FORMAT=PNG8 -co ZOOM_LEVEL_STRATEGY=LOWER -co RESAMPLING=NEAREST "$TMP/$name.tif" "$TMP/$name.mbtiles"
  gdaladdo -q -r average "$TMP/$name.mbtiles" 2 4 8 16
  rm -f "$OUT/noise-$name.pmtiles"
  .venv/bin/pmtiles-convert "$TMP/$name.mbtiles" "$OUT/noise-$name.pmtiles"
done

echo "Facades…"
ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6 "$TMP/f.geojsonl" "$SRC/buildings/exposure.gpkg" \
  -sql "SELECT id AS b, side, dir, ROUND(ld) AS ld, ROUND(ln) AS ln, geom FROM facades WHERE ld IS NOT NULL AND ln IS NOT NULL"
ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -lco COORDINATE_PRECISION=6 "$TMP/h.geojsonl" "$SRC/buildings/buildings.gpkg" \
  -sql "SELECT id AS b, geom FROM buildings"
tippecanoe -q -f -o "$OUT/facades.pmtiles" -Z14 -z14 --no-feature-limit --no-tile-size-limit --no-tiny-polygon-reduction \
  -L "f:$TMP/f.geojsonl" -L "h:$TMP/h.geojsonl"

ls -lh "$OUT"
