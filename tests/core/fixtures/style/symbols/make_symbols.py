import sys, os
from qgis.core import *
QgsApplication.setPrefixPath(r"C:\OSGeo4W\apps\qgis", True)
app = QgsApplication([], False); app.initQgis()
out = sys.argv[1]
def save(layer, name):
    layer.saveNamedStyle(os.path.join(out, name + '.qml'))
    layer.saveSldStyle(os.path.join(out, name + '.sld'))
pt = QgsVectorLayer('Point?crs=EPSG:4326&field=v:double', 'pts', 'memory')
for shape in ['square','triangle','diamond','star','cross_fill','cross','cross2']:
    sym = QgsMarkerSymbol.createSimple({'name': shape, 'size': '4', 'size_unit':'Pixel', 'color':'255,0,0,255'})
    pt.setRenderer(QgsSingleSymbolRenderer(sym)); save(pt, 'pt_' + shape)
ln = QgsVectorLayer('LineString?crs=EPSG:4326&field=v:double', 'lns', 'memory')
for st in ['dash','dot','dash dot','dash dot dot']:
    sym = QgsLineSymbol.createSimple({'line_style': st, 'line_width': '2', 'line_width_unit':'Pixel'})
    ln.setRenderer(QgsSingleSymbolRenderer(sym)); save(ln, 'ln_' + st.replace(' ','_'))
# graduated size
r = QgsGraduatedSymbolRenderer('v', [QgsRendererRange(0, 10, QgsMarkerSymbol.createSimple({'size':'2'}), 'a'), QgsRendererRange(10, 20, QgsMarkerSymbol.createSimple({'size':'2'}), 'b'), QgsRendererRange(20, 30, QgsMarkerSymbol.createSimple({'size':'2'}), 'c')])
r.setGraduatedMethod(Qgis.GraduatedMethod.Size)
r.setSymbolSizes(2, 10)
pt.setRenderer(r); save(pt, 'pt_gradsize')
r2 = QgsGraduatedSymbolRenderer('v', [QgsRendererRange(0, 10, QgsLineSymbol.createSimple({}), 'a'), QgsRendererRange(10, 20, QgsLineSymbol.createSimple({}), 'b')])
r2.setGraduatedMethod(Qgis.GraduatedMethod.Size); r2.setSymbolSizes(1, 5)
ln.setRenderer(r2); save(ln, 'ln_gradsize')
print('ok')
