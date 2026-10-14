"""Spec 011 SC-003: QGIS draws properties that vary by a column as the app does.

For every `<case>.qml` in a directory (with `<case>.geojson` and
`<case>.expected.json`, written by tests/core/qgis-011-cases.test.ts with
SE_QGIS_011=<dir>), loads the data and the QML into QGIS and asks QGIS's
renderer, inside a render context, which symbol each feature gets, then
evaluates its data-defined properties per feature: outline color and width,
marker shape (name) and angle, line pattern, and the symbol's opacity
(percent; 0 means hidden). Compares with what the app draws.
Prints a JSON summary; exit code 1 on any mismatch.

    C:\\OSGeo4W\\bin\\python-qgis.bat tests\\qgis\\check_011.py <dir>
"""
import glob
import json
import os
import sys

from qgis.core import (
    QgsApplication,
    QgsExpressionContextUtils,
    QgsRenderContext,
    QgsSimpleMarkerSymbolLayerBase,
    QgsSymbol,
    QgsSymbolLayer,
    QgsSymbolLayerUtils,
    QgsUnitTypes,
    QgsVectorLayer,
)

P = QgsSymbolLayer.Property


def dd(props, key, ctx, kind, static):
    """A data-defined property's value for the current feature, else the static one."""
    if not props.isActive(key):
        return static
    ec = ctx.expressionContext()
    if kind == 'color':
        value, ok = props.valueAsColor(key, ec, static)
    elif kind == 'number':
        value, ok = props.valueAsDouble(key, ec, static)
    else:
        value, ok = props.valueAsString(key, ec, static)
    return value if ok else static


def look(symbol, ctx, geometry):
    layer = symbol.symbolLayer(0)
    props = layer.dataDefinedProperties()
    sym_props = symbol.dataDefinedProperties()
    opacity = symbol.opacity() * 100
    if sym_props.isActive(QgsSymbol.Property.Opacity):
        value, ok = sym_props.valueAsDouble(QgsSymbol.Property.Opacity, ctx.expressionContext(), opacity)
        opacity = value if ok else opacity
    got = {'visible': opacity > 0, 'color': symbol.color().name(), 'opacity': round(opacity, 2)}
    if geometry == 'point':
        got['strokeColor'] = dd(props, P.StrokeColor, ctx, 'color', layer.strokeColor()).name()
        got['strokeWidth'] = round(dd(props, P.StrokeWidth, ctx, 'number', layer.strokeWidth()), 4)
        got['shape'] = dd(props, P.Name, ctx, 'string', QgsSimpleMarkerSymbolLayerBase.encodeShape(layer.shape()))
        got['angle'] = round(dd(props, P.Angle, ctx, 'number', layer.angle()), 4) % 360
    elif geometry == 'polygon':
        got['strokeColor'] = dd(props, P.StrokeColor, ctx, 'color', layer.strokeColor()).name()
        got['strokeWidth'] = round(dd(props, P.StrokeWidth, ctx, 'number', layer.strokeWidth()), 4)
    else:
        got['strokeWidth'] = round(dd(props, P.StrokeWidth, ctx, 'number', layer.width()), 4)
        got['dash'] = dd(props, P.StrokeStyle, ctx, 'string', QgsSymbolLayerUtils.encodePenStyle(layer.penStyle()))
    return got


def close_colors(a, b, tolerance=2):
    """Two #rrggbb colors within `tolerance` per channel (QGIS's color_mix_rgb rounds its own way)."""
    if not (isinstance(a, str) and isinstance(b, str) and a.startswith('#') and b.startswith('#') and len(a) == len(b) == 7):
        return a == b
    return all(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) <= tolerance for i in (1, 3, 5))


def same(want, got):
    for key, value in want.items():
        if key == 'visible':
            continue
        if key in ('color', 'strokeColor'):
            if not close_colors(value, got[key]):
                return False
            continue
        if key == 'angle':
            if abs((got[key] - value % 360 + 180) % 360 - 180) > 1e-3:
                return False
        elif isinstance(value, (int, float)):
            if abs(got[key] - value) > 1e-2:
                return False
        elif got[key] != value:
            return False
    return True


def check(qml):
    base = qml[:-4]
    expected = json.load(open(base + '.expected.json'))
    geometry = expected['geometry']
    layer = QgsVectorLayer(base + '.geojson', 'case', 'ogr')
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
        got = look(symbols[0], ctx, geometry) if symbols else {'visible': False}
        if not want['visible']:
            if got['visible']:
                mismatches.append({'feature': i, 'want': want, 'got': got})
            continue
        # Opacity 0 draws nothing in both (QGIS's symbol alpha 0 reads as hidden here).
        transparent = want.get('opacity') == 0 and got.get('opacity') == 0
        if not (got['visible'] or transparent) or not same(want, got):
            mismatches.append({'feature': i, 'want': want, 'got': got})
    renderer.stopRender(ctx)
    label_mismatches = check_labels(layer, expected.get('labels'))
    mismatches.extend(label_mismatches)
    return {'case': os.path.basename(base), 'loaded': bool(ok), 'renderer': renderer.type(), 'features': len(expected['features']), 'labels': expected.get('labels') is not None, 'mismatches': mismatches[:5], 'mismatchCount': len(mismatches)}


def number(v):
    """A QGIS enum (PyQt6: an object with .value) or int as an int."""
    return int(getattr(v, 'value', v))


def check_labels(layer, want):
    """Spec 011 US6: the layer's labels as QGIS read them (text, size in px, color, buffer, placement)."""
    if want is None:
        return [{'labels': 'unexpected'}] if layer.labelsEnabled() else []
    if not layer.labelsEnabled() or layer.labeling() is None:
        return [{'labels': 'not enabled'}]
    s = layer.labeling().settings()
    fmt = s.format()
    buf = fmt.buffer()
    got = {
        'fieldName': s.fieldName,
        'isExpression': bool(s.isExpression),
        'size': round(fmt.size(), 2),
        'color': fmt.color().name(),
        'buffer': bool(buf.enabled()),
        'placement': number(s.placement),
    }
    if 'bufferSize' in want:
        got['bufferSize'] = round(buf.size(), 2)
        got['bufferColor'] = buf.color().name()
    if 'quadOffset' in want:
        got['quadOffset'] = number(s.pointSettings().quadrant() if hasattr(s, 'pointSettings') else s.quadOffset)
    if 'dist' in want:
        got['dist'] = round(s.dist, 2)
    units = number(fmt.sizeUnit())
    return [] if got == want and units == number(QgsUnitTypes.RenderPixels if hasattr(QgsUnitTypes, 'RenderPixels') else 1) else [{'labels': {'want': want, 'got': got, 'sizeUnit': units}}]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    app = QgsApplication([], False)
    app.initQgis()
    results = [check(q) for q in sorted(glob.glob(os.path.join(sys.argv[1], '*.qml')))]
    out = json.dumps(results, indent=1)
    print(out)
    with open(os.path.join(sys.argv[1], 'check_011.json'), 'w') as f:
        f.write(out)
    sys.stdout.flush()
    os._exit(0 if all(r['mismatchCount'] == 0 and r['loaded'] for r in results) else 1)


if __name__ == '__main__':
    main()
