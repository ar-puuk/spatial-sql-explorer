"""Reads exported data files the way QGIS does (OGR provider) and prints, per
file, as JSON: validity, CRS, feature count, fields, and the first feature's
bounding box and geometry type. Spec 005 SC-002 (optional, local PyQGIS):

    C:\OSGeo4W\bin\python-qgis.bat tests\qgis\read_back.py out.parquet out.geojson out.csv
"""
import json, sys
from qgis.core import QgsApplication, QgsVectorLayer
app = QgsApplication([], False); app.initQgis()
for path in sys.argv[1:]:
    layer = QgsVectorLayer(path, 'x', 'ogr')
    info = {'file': path.split('\\')[-1], 'valid': layer.isValid()}
    if layer.isValid():
        info['crs'] = layer.crs().authid() or layer.crs().description()
        info['count'] = layer.featureCount()
        info['fields'] = [f'{f.name()}:{f.typeName()}' for f in layer.fields()]
        feat = next(layer.getFeatures(), None)
        if feat is not None and feat.hasGeometry():
            b = feat.geometry().boundingBox()
            info['bbox'] = [round(b.xMinimum()), round(b.yMinimum()), round(b.xMaximum()), round(b.yMaximum())]
            info['geomType'] = feat.geometry().wkbType().name if hasattr(feat.geometry().wkbType(), 'name') else str(feat.geometry().wkbType())
    print(json.dumps(info))
app.exitQgis()
