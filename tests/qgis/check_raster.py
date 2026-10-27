"""Loads each raster style case the way QGIS does and compares what QGIS sees with what the app meant.

Spec 026 (SC-003 for rasters): the `.qml` Spatial Explorer saves beside a GeoTIFF must be read by QGIS as the same
renderer, band(s), range, opacity, colors and transparent value. Optional and local, like the other checks here. First
write the cases with the core test, then run this with QGIS's Python (PyQGIS), for example on Windows (OSGeo4W):

    set SE_QGIS_026=%TEMP%\\se-qgis-026
    npm run test:core -- qgis-raster-cases
    C:\\OSGeo4W\\bin\\python-qgis.bat tests\\qgis\\check_raster.py %TEMP%\\se-qgis-026

Each case is `<name>.tif`, `<name>.qml` and `<name>.expected.json`. Prints one line per case and exits 1 on any difference.
"""
import json
import os
import sys

from qgis.core import QgsApplication, QgsRasterLayer


def close(a, b, tol=1e-6):
    return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))


def check(case_dir, name):
    layer = QgsRasterLayer(os.path.join(case_dir, name + '.tif'), name)
    message, ok = layer.loadNamedStyle(os.path.join(case_dir, name + '.qml'))
    expected = json.load(open(os.path.join(case_dir, name + '.expected.json')))
    problems = []
    if not layer.isValid():
        return ['the raster did not load']
    if not ok:
        problems.append('the style did not load: ' + message)
    r = layer.renderer()
    if r.type() != expected['renderer']:
        problems.append('renderer %s, expected %s' % (r.type(), expected['renderer']))
        return problems
    if not close(r.opacity(), expected['opacity']):
        problems.append('opacity %s, expected %s' % (r.opacity(), expected['opacity']))
    kind = r.type()
    if kind == 'singlebandpseudocolor':
        if r.band() != expected['bands'][0]:
            problems.append('band %s, expected %s' % (r.band(), expected['bands'][0]))
        if not (close(r.classificationMin(), expected['min']) and close(r.classificationMax(), expected['max'])):
            problems.append('range %s..%s, expected %s..%s' % (r.classificationMin(), r.classificationMax(), expected['min'], expected['max']))
        if 'ramp' in expected:
            items = r.shader().rasterShaderFunction().colorRampItemList()
            got = [i.color.name() for i in items]
            if got != expected['ramp']:
                problems.append('ramp %s, expected %s' % (got, expected['ramp']))
            if items and not (close(items[0].value, expected['min']) and close(items[-1].value, expected['max'])):
                problems.append('ramp ends %s..%s, expected %s..%s' % (items[0].value, items[-1].value, expected['min'], expected['max']))
    elif kind == 'singlebandgray':
        if r.grayBand() != expected['bands'][0]:
            problems.append('band %s, expected %s' % (r.grayBand(), expected['bands'][0]))
        ce = r.contrastEnhancement()
        if not (close(ce.minimumValue(), expected['min']) and close(ce.maximumValue(), expected['max'])):
            problems.append('range %s..%s, expected %s..%s' % (ce.minimumValue(), ce.maximumValue(), expected['min'], expected['max']))
        want = 'WhiteToBlack' if expected['reversed'] else 'BlackToWhite'
        got = 'WhiteToBlack' if r.gradient() == r.Gradient.WhiteToBlack else 'BlackToWhite'
        if got != want:
            problems.append('gradient %s, expected %s' % (got, want))
    elif kind == 'multibandcolor':
        bands = [r.redBand(), r.greenBand(), r.blueBand()]
        if bands != expected['bands']:
            problems.append('bands %s, expected %s' % (bands, expected['bands']))
        enh = [r.redContrastEnhancement(), r.greenContrastEnhancement(), r.blueContrastEnhancement()]
        for i, e in enumerate(enh):
            lo, hi = expected['rescale'][i]
            if e is None or not (close(e.minimumValue(), lo) and close(e.maximumValue(), hi)):
                problems.append('channel %d range differs, expected %s..%s' % (i, lo, hi))
    elif kind == 'paletted':
        got = [(c.value, c.color.name()) for c in r.classes()]
        want = [(c['value'], c['color']) for c in expected['classes']]
        if got != want:
            problems.append('classes %s, expected %s' % (got, want))
    if 'brightness' in expected:
        bf = layer.brightnessFilter()
        hf = layer.hueSaturationFilter()
        if bf is None or bf.brightness() != expected['brightness'] or bf.contrast() != expected['contrastShift']:
            problems.append('brightness/contrast %s/%s, expected %s/%s' % (bf and bf.brightness(), bf and bf.contrast(), expected['brightness'], expected['contrastShift']))
        if hf is None or hf.saturation() != expected['saturation']:
            problems.append('saturation %s, expected %s' % (hf and hf.saturation(), expected['saturation']))
    if 'transparentValue' in expected:
        entries = r.rasterTransparency().transparentSingleValuePixelList() if r.rasterTransparency() else []
        hit = [e for e in entries if close(e.min, expected['transparentValue']) and close(e.max, expected['transparentValue']) and e.percentTransparent == 100]
        if not hit:
            problems.append('no fully transparent entry for %s' % expected['transparentValue'])
    return problems


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    case_dir = sys.argv[1]
    names = sorted(f[:-len('.expected.json')] for f in os.listdir(case_dir) if f.endswith('.expected.json'))
    if not names:
        print('no cases in', case_dir)
        return 2
    app = QgsApplication([], False)
    app.initQgis()
    failed = 0
    try:
        for name in names:
            problems = check(case_dir, name)
            print(('PASS  ' if not problems else 'FAIL  ') + name + ('' if not problems else ': ' + '; '.join(problems)))
            failed += 1 if problems else 0
    finally:
        app.exitQgis()
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
