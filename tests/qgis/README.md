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
