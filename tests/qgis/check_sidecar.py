"""Loads a QML style the way QGIS does and prints what QGIS sees, as JSON.

Spec 003 SC-003: a sidecar Spatial Explorer saves must show the same
renderer, classes, colors, labels and visibility in QGIS. Optional and local:
run it with QGIS's Python (PyQGIS), for example on Windows (OSGeo4W):

    C:\\OSGeo4W\\bin\\python-qgis.bat tests\\qgis\\check_sidecar.py world.qml [geometry]

`geometry` is point, line or polygon (default polygon).
"""
import json
import sys

from qgis.core import QgsApplication, QgsVectorLayer


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    qml = sys.argv[1]
    geometry = {'point': 'Point', 'line': 'LineString', 'polygon': 'Polygon'}[sys.argv[2] if len(sys.argv) > 2 else 'polygon']
    app = QgsApplication([], False)
    app.initQgis()
    try:
        layer = QgsVectorLayer(f'{geometry}?crs=EPSG:4326', 'check', 'memory')
        message, ok = layer.loadNamedStyle(qml)
        renderer = layer.renderer()
        out = {'loaded': bool(ok), 'message': message, 'renderer': renderer.type()}
        if renderer.type() == 'categorizedSymbol':
            out['column'] = renderer.classAttribute()
            out['classes'] = [
                {'value': None if c.value() is None else str(c.value()), 'color': c.symbol().color().name(), 'label': c.label(), 'render': c.renderState()}
                for c in renderer.categories()
            ]
        elif renderer.type() == 'graduatedSymbol':
            out['column'] = renderer.classAttribute()
            method = renderer.classificationMethod()
            out['method'] = method.id() if method else None
            out['classes'] = [
                {'lower': r.lowerValue(), 'upper': r.upperValue(), 'color': r.symbol().color().name(), 'label': r.label(), 'render': r.renderState()}
                for r in renderer.ranges()
            ]
        elif renderer.type() == 'singleSymbol':
            out['color'] = renderer.symbol().color().name()
        print(json.dumps(out, indent=1))
        return 0 if ok else 1
    finally:
        app.exitQgis()


if __name__ == '__main__':
    sys.exit(main())
