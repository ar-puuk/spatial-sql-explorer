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
SE_QGIS_CASES=C:	mp\qgis009 npx vitest run qgis-cases      (in tests/core)
C:\OSGeo4Win\python-qgis.bat tests\qgis\check_009.py C:	mp\qgis009
```

Last run: see `specs/009-multichannel-bivariate/research.md` §5.
