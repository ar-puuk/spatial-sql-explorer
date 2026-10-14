r"""Clusters: QGIS reads the cluster QML (its point cluster renderer).

Loads <dir>/clusters.qml (written by tests/core/qgis-clusters-cases.test.ts
with SE_QGIS_CLUSTERS=<dir>) onto <dir>/points.geojson, prints the renderer
type, distance and unit, then renders it: the group of 300 must take the third
step's color, the group of 120 the second's, and a point on its own the
single symbol's fill. Exit code 1 on a mismatch.

    C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_clusters.py <dir>
"""
import json
import os
import sys

from qgis.core import Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsMapRendererSequentialJob, QgsMapSettings, QgsRectangle, QgsVectorLayer
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor

SIZE = 400
EXTENT = QgsRectangle(-0.45, -0.45, 0.45, 0.45)


def render(layer):
    settings = QgsMapSettings()
    settings.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:4326'))
    settings.setLayers([layer])
    settings.setExtent(EXTENT)
    settings.setOutputSize(QSize(SIZE, SIZE))
    settings.setBackgroundColor(QColor(255, 255, 255, 0))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    return job.renderedImage()


def pixel(image, lon, lat):
    x = int((lon - EXTENT.xMinimum()) / EXTENT.width() * SIZE)
    y = int((EXTENT.yMaximum() - lat) / EXTENT.height() * SIZE)
    return image.pixelColor(x, y)


def main(directory):
    app = QgsApplication([], False)
    app.initQgis()
    ok = True
    expected = json.load(open(os.path.join(directory, 'expected.json')))
    layer = QgsVectorLayer(os.path.join(directory, 'points.geojson'), 'points', 'ogr')
    message, loaded = layer.loadNamedStyle(os.path.join(directory, 'clusters.qml'))
    r = layer.renderer()
    print('clusters.qml loaded:', loaded, message, '|', r.type(), 'tolerance', r.tolerance(), r.toleranceUnit(), 'inside', r.embeddedRenderer().type())
    if r.type() != 'pointCluster' or r.tolerance() != expected['tolerance'] or r.toleranceUnit() != Qgis.RenderUnit.Pixels or r.embeddedRenderer().type() != 'singleSymbol':
        print('  MISMATCH: renderer, distance or unit')
        ok = False
    image = render(layer)
    image.save(os.path.join(directory, 'clusters-qgis.png'))
    for name in ('big', 'mid', 'loner'):
        case = expected[name]
        got = pixel(image, *case['at'])
        want = QColor(case['color'])
        diff = abs(got.red() - want.red()) + abs(got.green() - want.green()) + abs(got.blue() - want.blue())
        print(f'  {name}: {got.name()} (alpha {got.alpha()}) vs {want.name()}')
        if diff > 30 or got.alpha() < 200:
            print('  MISMATCH: color')
            ok = False
    app.exitQgis()
    return ok


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1]) else 1)
