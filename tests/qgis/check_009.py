"""Spec 009 SC-005: QGIS draws a size-channel style as the app does.

For every `<case>.qml` in a directory (with `<case>.geojson` and
`<case>.expected.json`, written by tests/core/qgis-cases.test.ts with
SE_QGIS_CASES=<dir>), loads the data and the QML into QGIS and asks QGIS's
renderer, inside a render context, which symbol each feature gets and the
size its data-defined property evaluates to (line width, or marker
diameter). Compares color, size and drawn/hidden with what the app draws.
Prints a JSON summary; exit code 1 on any mismatch.

    C:\\OSGeo4W\\bin\\python-qgis.bat tests\\qgis\\check_009.py <dir>
"""
import glob
import json
import os
import sys

from qgis.core import QgsApplication, QgsExpressionContextUtils, QgsRenderContext, QgsSymbolLayer, QgsVectorLayer


def size_of(symbol, ctx, geometry):
    layer = symbol.symbolLayer(0)
    key = QgsSymbolLayer.Property.Size if geometry == 'point' else QgsSymbolLayer.Property.StrokeWidth
    static = layer.size() if geometry == 'point' else layer.width()
    props = layer.dataDefinedProperties()
    if props.isActive(key):
        value, ok = props.valueAsDouble(key, ctx.expressionContext(), static)
        return value if ok else static
    return static


def check(qml):
    base = qml[:-4]
    expected = json.load(open(base + '.expected.json'))
    geometry = expected['geometry']
    layer = QgsVectorLayer(base + '.geojson', 'case', 'ogr')
    # Spec 009 US4: bivariate polygons (color and visibility only).
    message, ok = layer.loadNamedStyle(qml)
    renderer = layer.renderer().clone()
    ctx = QgsRenderContext()
    ctx.expressionContext().appendScopes(QgsExpressionContextUtils.globalProjectLayerScopes(layer))
    renderer.startRender(ctx, layer.fields())
    mismatches = []
    for i, feature in enumerate(layer.getFeatures()):
        want = expected['features'][i]
        ctx.expressionContext().setFeature(feature)
        symbols = renderer.symbolsForFeature(feature, ctx)
        if not symbols:
            got = {'visible': False}
        else:
            symbol = symbols[0]
            # Polygons have no size channel: drawn when QGIS gives them a symbol.
            size = size_of(symbol, ctx, geometry) if geometry != 'polygon' else 1
            got = {'visible': size > 0, 'color': symbol.color().name(), 'size': round(size, 4)}
        if not want['visible']:
            if got['visible']:
                mismatches.append({'feature': i, 'want': want, 'got': got})
            continue
        size_differs = want.get('size') is not None and abs(got['size'] - want['size']) > 1e-3
        if not got['visible'] or got['color'] != want['color'] or size_differs:
            mismatches.append({'feature': i, 'want': want, 'got': got})
    renderer.stopRender(ctx)
    return {'case': os.path.basename(base), 'loaded': bool(ok), 'renderer': renderer.type(), 'features': len(expected['features']), 'mismatches': mismatches[:5], 'mismatchCount': len(mismatches)}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    app = QgsApplication([], False)
    app.initQgis()
    results = [check(q) for q in sorted(glob.glob(os.path.join(sys.argv[1], '*.qml')))]
    out = json.dumps(results, indent=1)
    print(out)
    with open(os.path.join(sys.argv[1], 'check_009.json'), 'w') as f:
        f.write(out)
    sys.stdout.flush()
    os._exit(0 if all(r['mismatchCount'] == 0 and r['loaded'] for r in results) else 1)


if __name__ == '__main__':
    main()
