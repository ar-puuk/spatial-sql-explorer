# QGIS interop check (optional, local)

`check_sidecar.py` loads a QML style into a QGIS layer exactly as QGIS
would, and prints the renderer, classes, colors, labels and render
(visibility) flags it sees. Spec 003's SC-003 says a sidecar saved by Spatial
Explorer shows the same classes in QGIS; this script is how that is checked
against a real QGIS.

It needs QGIS's Python (PyQGIS), which is not part of the automated suites.
On Windows with OSGeo4W:

```
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_sidecar.py path\to\layer.qml polygon
```

Last run: see `specs/003-thematic-styling/research.md`, "SC-003: QML written
by the app, read by QGIS".

## Export read-back (`read_back.py`)

Prints, per exported file, what QGIS's OGR provider sees: validity, CRS,
feature count, fields, and the first feature's bounding box and type. Spec 005
covers GeoParquet, GeoJSON and CSV; spec 008 adds GeoPackage, FlatGeobuf,
KML, GeoJSONSeq, Excel, JSON and zipped Shapefiles (read through `/vsizip/`).

```
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\read_back.py out.gpkg out.fgb out.shp.zip out.kml
```

Last run: see `specs/008-ux-parity/research.md`, "Implementation outcomes (US4)".

## Size channel parity (`check_009.py`, spec 009)

`tests/core/qgis-cases.test.ts` writes QGIS parity cases when
`SE_QGIS_CASES` names a directory: the data (GeoJSON), the QML the app saves,
and what the map draws per feature (color, line width or marker diameter,
drawn or hidden). `check_009.py` loads each case into QGIS and asks QGIS's
renderer, in a render context, the same per feature. It exits 1 on any
mismatch.

```
SE_QGIS_CASES=C:\tmp\qgis009 npx vitest run qgis-cases      (in tests/core)
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_009.py C:\tmp\qgis009
```

Last run: see `specs/009-multichannel-bivariate/research.md` §5.

## Rules and graduated by expression (`check_010_rules.py`, spec 010)

`tests/core/qgis-rules-cases.test.ts` writes the cases when `SE_QGIS_RULES`
names a directory: a small polygon GeoJSON (overlapping and missing values),
the rules QML and the graduated-by-expression QML the app saves, and the color
each feature gets in the app (first matching rule). `check_010_rules.py` loads
them into QGIS, renders the layer and samples each feature's center pixel
(`symbolsForFeature` also lists an ELSE rule's symbol for matched features;
QGIS applies ELSE while rendering), then prints the graduated renderer's
`classAttribute`. It exits 1 on any mismatch.

```
SE_QGIS_RULES=out npx vitest run qgis-rules-cases   (in tests/core)
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_010_rules.py out
```

Last run: see `specs/010-redesign/research.md`, "Phase 11".

## Heatmap (`check_heatmap.py`)

`tests/core/qgis-heatmap-cases.test.ts` writes clustered points and the
heatmap QML the app saves, with the radius in pixels and in meters (QGIS's
"meters at scale", weighted by a field), when `SE_QGIS_HEATMAP` names a
directory. `check_heatmap.py` loads both, checks the renderer, unit and
weight, and renders them in Web Mercator: the densest pixel must be the
ramp's last color, and an empty corner must stay transparent.

```
SE_QGIS_HEATMAP=out npx vitest run qgis-heatmap-cases   (in tests/core)
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_heatmap.py out
```

Last run (2026-10-13, QGIS 4.2.3): both load as `heatmapRenderer` (15 px; 3000 m
at scale, weight `"pop"`), densest pixels #b20026 and #b10026 against #b10026.

## Vary by attribute (`check_011.py`, spec 011)

`tests/core/qgis-011-cases.test.ts` writes the cases when `SE_QGIS_011` names
a directory: the data (GeoJSON), the QML the app saves, and what the map draws
per feature, read from the map's own expressions: color, outline color and
width, marker shape (QGIS's name) and angle (our "x" is QGIS's filled cross
turned 45°), line pattern, opacity in percent, drawn or hidden.
`check_011.py` loads each case into QGIS, takes each feature's symbol from the
renderer in a render context, and evaluates the symbol layer's data-defined
properties and the symbol's opacity (0: hidden). It exits 1 on any mismatch.

```
SE_QGIS_011=C:\tmp\qgis011 npx vitest run qgis-011-cases   (in tests/core)
C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_011.py C:\tmp\qgis011
```

Last run: see `specs/011-style-channels/research.md`, "SC-003".
