"""Spec 010 phase 11: QGIS reads the rules and graduated-by-expression QML.

Loads <dir>/rules.qml and <dir>/expression.qml (written by
tests/core/qgis-rules-cases.test.ts with SE_QGIS_RULES=<dir>) onto
<dir>/world.geojson, prints the renderer type, rules (filter, label, active),
and per feature the color QGIS paints at its center (rendered), compared with
<dir>/rules.expected.json (the first matching rule, as the app draws). Then
the graduated renderer's classAttribute and ranges. Exit code 1 on a mismatch.

    C:\\OSGeo4W\\bin\\python-qgis.bat tests\\qgis\\check_010_rules.py <dir>
"""
import json
import os
import sys

from qgis.core import QgsApplication, QgsMapRendererSequentialJob, QgsMapSettings, QgsRectangle, QgsVectorLayer
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor


def main(directory):
    app = QgsApplication([], False)
    app.initQgis()
    ok = True
    data = os.path.join(directory, 'world.geojson')

    layer = QgsVectorLayer(data, 'world', 'ogr')
    message, loaded = layer.loadNamedStyle(os.path.join(directory, 'rules.qml'))
    renderer = layer.renderer()
    print('rules.qml loaded:', loaded, message)
    print('renderer:', renderer.type())
    children = renderer.rootRule().children()
    print('rules:', len(children))
    for rule in children:
        print('  filter=%r label=%r active=%s else=%s' % (rule.filterExpression(), rule.label(), rule.active(), rule.isElse()))
    expected = json.load(open(os.path.join(directory, 'rules.expected.json')))['features']
    # What QGIS paints: render the layer and sample each square's center. (symbolsForFeature
    # lists an ELSE rule's symbol even for matched features; ELSE is applied while rendering.)
    xmin, xmax, ymin, ymax, width, height = -0.1, 6.0, -0.1, 0.9, 610, 100
    settings = QgsMapSettings()
    settings.setLayers([layer])
    settings.setDestinationCrs(layer.crs())
    settings.setExtent(QgsRectangle(xmin, ymin, xmax, ymax))
    settings.setOutputSize(QSize(width, height))
    settings.setBackgroundColor(QColor('#ffffff'))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    image = job.renderedImage()
    extent = settings.visibleExtent()
    for i, feature in enumerate(layer.getFeatures()):
        center = feature.geometry().centroid().asPoint()
        px = int((center.x() - extent.xMinimum()) / extent.width() * image.width())
        py = int((extent.yMaximum() - center.y()) / extent.height() * image.height())
        painted = image.pixelColor(px, py).name()
        match = painted == expected[i]
        ok = ok and match
        print('  feature %d %s: painted %s (want %s)%s' % (i, dict(zip(layer.fields().names(), feature.attributes())), painted, expected[i], '' if match else '  MISMATCH'))

    layer2 = QgsVectorLayer(data, 'world', 'ogr')
    message, loaded = layer2.loadNamedStyle(os.path.join(directory, 'expression.qml'))
    g = layer2.renderer()
    print('expression.qml loaded:', loaded, message)
    print('renderer:', g.type(), 'classAttribute:', g.classAttribute())
    for rng in g.ranges():
        print('  %s .. %s %s' % (rng.lowerValue(), rng.upperValue(), rng.label()))
    expr_ok = g.type() == 'graduatedSymbol' and g.classAttribute() == 'gdp_md * 1e6 / pop_est'
    ok = ok and expr_ok
    print('OK' if ok else 'MISMATCH')
    app.exitQgis()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
