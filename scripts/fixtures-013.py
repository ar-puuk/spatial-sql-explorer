# Spec 013 fixture: tests/vscode-ext/fixtures/network.gdb, a small File Geodatabase made with GDAL's
# OpenFileGDB writer (3.5+). Run through scripts/fixtures-013.mjs, which also makes the zips.
#
#   net (feature dataset, NAD83 / UTM zone 12N)
#     roads  6 lines   class -> coded domain RoadClass, lanes -> range domain Lanes, name, speed
#     nodes  5 points  kind  -> coded domain NodeKind (the integer codes are not the ones in RoadClass)
#   codes    3 rows    an attribute-only table
import os
import shutil
import sys

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
out = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else 'network'
if os.path.exists(out):
    shutil.rmtree(out)

ds = gdal.GetDriverByName('OpenFileGDB').Create(out, 0, 0, 0, gdal.GDT_Unknown)

if mode == 'nocrs':
    # nocrs.gdb: one layer of 3 points (coordinates in UTM 12N) that records no coordinate system.
    sketch = ds.CreateLayer('sketch', None, ogr.wkbPoint)
    sketch.CreateField(ogr.FieldDefn('label', ogr.OFTString))
    for label, x, y in [('a', 425000, 4505000), ('b', 426000, 4506000), ('c', 427000, 4507000)]:
        ft = ogr.Feature(sketch.GetLayerDefn())
        ft.SetField('label', label)
        ft.SetGeometry(ogr.CreateGeometryFromWkt(f'POINT({x} {y})'))
        sketch.CreateFeature(ft)
    ds = None
    print('ok')
    sys.exit(0)
ds.AddFieldDomain(ogr.CreateCodedFieldDomain('RoadClass', 'Road class', ogr.OFTInteger, ogr.OFSTNone, {1: 'Freeway', 2: 'Arterial', 3: 'Local'}))
ds.AddFieldDomain(ogr.CreateCodedFieldDomain('NodeKind', 'Node kind', ogr.OFTInteger, ogr.OFSTNone, {10: 'Junction', 20: 'Signal'}))
ds.AddFieldDomain(ogr.CreateRangeFieldDomain('Lanes', 'Lane count', ogr.OFTInteger, ogr.OFSTNone, 1, True, 12, True))

srs = osr.SpatialReference()
srs.ImportFromEPSG(26912)
srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

roads = ds.CreateLayer('roads', srs, ogr.wkbLineString, options=['FEATURE_DATASET=net'])
for name, domain in (('class', 'RoadClass'), ('lanes', 'Lanes')):
    f = ogr.FieldDefn(name, ogr.OFTInteger)
    f.SetDomainName(domain)
    roads.CreateField(f)
roads.CreateField(ogr.FieldDefn('name', ogr.OFTString))
roads.CreateField(ogr.FieldDefn('speed', ogr.OFTReal))
rows = [
    (1, 6, 'I-15', 65.0, 'LINESTRING(425000 4500000, 425000 4510000)'),
    (1, 4, 'I-80', 65.0, 'LINESTRING(420000 4505000, 430000 4505000)'),
    (2, 4, 'State St', 35.0, 'LINESTRING(425500 4500000, 425500 4508000)'),
    (2, 2, '700 East', 30.0, 'LINESTRING(426500 4501000, 426500 4509000)'),
    (3, 2, 'Elm Ave', 25.0, 'LINESTRING(424000 4503000, 425000 4503000)'),
    (3, 2, 'Oak Ave', 25.0, 'LINESTRING(427000 4506000, 428000 4506000)'),
]
for cls, lanes, name, speed, wkt in rows:
    ft = ogr.Feature(roads.GetLayerDefn())
    ft.SetField('class', cls)
    ft.SetField('lanes', lanes)
    ft.SetField('name', name)
    ft.SetField('speed', speed)
    ft.SetGeometry(ogr.CreateGeometryFromWkt(wkt))
    roads.CreateFeature(ft)

nodes = ds.CreateLayer('nodes', srs, ogr.wkbPoint, options=['FEATURE_DATASET=net'])
nodes.CreateField(ogr.FieldDefn('node_id', ogr.OFTInteger))
f = ogr.FieldDefn('kind', ogr.OFTInteger)
f.SetDomainName('NodeKind')
nodes.CreateField(f)
for i, (kind, x, y) in enumerate([(10, 425000, 4505000), (20, 425500, 4505000), (10, 425500, 4503000), (20, 426500, 4505000), (10, 427000, 4506000)]):
    ft = ogr.Feature(nodes.GetLayerDefn())
    ft.SetField('node_id', i + 1)
    ft.SetField('kind', kind)
    ft.SetGeometry(ogr.CreateGeometryFromWkt(f'POINT({x} {y})'))
    nodes.CreateFeature(ft)

codes = ds.CreateLayer('codes', None, ogr.wkbNone)
codes.CreateField(ogr.FieldDefn('code', ogr.OFTInteger))
codes.CreateField(ogr.FieldDefn('label', ogr.OFTString))
for code, label in [(1, 'one'), (2, 'two'), (3, 'three')]:
    ft = ogr.Feature(codes.GetLayerDefn())
    ft.SetField('code', code)
    ft.SetField('label', label)
    codes.CreateFeature(ft)
ds = None
print('ok')
