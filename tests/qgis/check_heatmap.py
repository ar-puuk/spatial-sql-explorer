r"""Heatmap: QGIS reads the heatmap QML (radius in pixels, and in meters at scale).

Loads <dir>/heatmap-px.qml and <dir>/heatmap-m.qml (written by
tests/core/qgis-heatmap-cases.test.ts with SE_QGIS_HEATMAP=<dir>) onto
<dir>/points.geojson, prints the renderer type, radius, unit and weight, then
renders it: the densest pixel must be the ramp's last color (QGIS's automatic
maximum), and a corner must be empty. Exit code 1 on a mismatch.

    C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_heatmap.py <dir>
"""
import json
import os
import sys

from qgis.core import Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsMapRendererSequentialJob, QgsMapSettings, QgsRectangle, QgsVectorLayer
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor


def render(layer, extent):
    settings = QgsMapSettings()
    # Web Mercator, as the app draws (meters at scale need a projected map).
    settings.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:3857'))
    settings.setEllipsoid('EPSG:7030')
    settings.setLayers([layer])
    settings.setExtent(extent)
    settings.setOutputSize(QSize(300, 300))
    settings.setBackgroundColor(QColor(255, 255, 255, 0))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    return job.renderedImage()


def main(directory):
    app = QgsApplication([], False)
    app.initQgis()
    ok = True
    densest = QColor(json.load(open(os.path.join(directory, 'expected.json')))['densest'])
    for name, unit, weight in (('px', Qgis.RenderUnit.Pixels, ''), ('m', Qgis.RenderUnit.MetersInMapUnits, '"pop"')):
        layer = QgsVectorLayer(os.path.join(directory, 'points.geojson'), 'points', 'ogr')
        message, loaded = layer.loadNamedStyle(os.path.join(directory, f'heatmap-{name}.qml'))
        r = layer.renderer()
        print(f'heatmap-{name}.qml loaded:', loaded, message, '|', r.type(), 'radius', r.radius(), r.radiusUnit(), 'weight', repr(r.weightExpression()))
        if r.type() != 'heatmapRenderer' or r.radiusUnit() != unit or r.weightExpression() != weight:
            print('  MISMATCH: renderer, unit or weight')
            ok = False
            continue
        image = render(layer, QgsRectangle(-39000, -39000, 39000, 39000))
        best = max(((image.pixelColor(x, y), x, y) for x in range(0, 300, 2) for y in range(0, 300, 2)), key=lambda t: t[0].alpha() * 1000 - t[0].lightness())
        c = best[0]
        diff = abs(c.red() - densest.red()) + abs(c.green() - densest.green()) + abs(c.blue() - densest.blue())
        corner = image.pixelColor(2, 2)
        print(f'  densest pixel {c.name()} (alpha {c.alpha()}) at {best[1:]} vs ramp end {densest.name()}; corner alpha {corner.alpha()}')
        if diff > 30 or corner.alpha() > 10:
            print('  MISMATCH: colors')
            ok = False
    app.exitQgis()
    return ok


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1]) else 1)
