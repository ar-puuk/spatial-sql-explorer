"""Spec 008: candidate EPSG CRS list for the export CRS picker.

Reads PROJ's database (proj.db, e.g. from OSGeo4W/QGIS) and writes every
non-deprecated EPSG geographic 2D and projected CRS with its area of use:

    C:\\OSGeo4W\\bin\\python-qgis.bat scripts\\crs-catalog.py [path\\to\\proj.db]

Output: scripts/.crs-candidates.json (gitignored). The engine's PROJ is
older than QGIS's, so the list is then filtered to the codes the WASM build
can transform to (tests/web/specs/crs-catalog.tool.spec.ts), which writes
packages/core/src/export/epsgCatalog.json.
"""
import json
import re
import os
import sqlite3
import sys

db = sys.argv[1] if len(sys.argv) > 1 else r'C:\OSGeo4W\share\proj\proj.db'
c = sqlite3.connect(db)
meta = dict(c.execute("SELECT key, value FROM metadata WHERE key IN ('EPSG.VERSION', 'PROJ.VERSION')").fetchall())
rows = c.execute(
    """
    SELECT v.code, v.name, v.type, e.name, e.west_lon, e.south_lat, e.east_lon, e.north_lat, cv.method_name
    FROM crs_view v
    JOIN usage u ON u.object_table_name = v.table_name AND u.object_auth_name = v.auth_name AND u.object_code = v.code
    JOIN extent e ON e.auth_name = u.extent_auth_name AND e.code = u.extent_code
    LEFT JOIN projected_crs p ON v.table_name = 'projected_crs' AND p.auth_name = v.auth_name AND p.code = v.code
    LEFT JOIN conversion cv ON cv.auth_name = p.conversion_auth_name AND cv.code = p.conversion_code
    WHERE v.auth_name = 'EPSG' AND v.deprecated = 0 AND v.type IN ('geographic 2D', 'projected')
    ORDER BY CAST(v.code AS INTEGER), u.code
    """
).fetchall()


def group_of(name, kind, area, method):
    """The picker's group, as QGIS (projection method) and ArcGIS (systems: UTM, State Plane, World) group them."""
    if kind == 'geographic 2D':
        return 'Geographic'
    if 'UTM zone' in name:
        return 'Universal Transverse Mercator (UTM)'
    if 'SPCS' in area:
        return 'US State Plane'
    if 'Gauss-Kruger' in name or 'Gauss-Krüger' in name:
        return 'Gauss-Krüger'
    if area.startswith('World'):
        return 'World'
    m = re.sub(r'\s*\(.*?\)', '', method or 'Other').strip()
    return {'Lambert Conic Conformal': 'Lambert Conformal Conic', 'Hotine Oblique Mercator': 'Oblique Mercator'}.get(m, m)


seen = set()
out = []
for code, name, kind, area, w, s, e, n, method in rows:
    code = int(code)
    if code in seen:
        continue  # the first usage is the CRS's main area of use
    seen.add(code)
    out.append([code, name, 'g' if kind == 'geographic 2D' else 'p', area, round(w, 2), round(s, 2), round(e, 2), round(n, 2), group_of(name, kind, area, method)])
# Small families go to "Other projections".
counts = {}
for r in out:
    counts[r[8]] = counts.get(r[8], 0) + 1
for r in out:
    if counts[r[8]] < 8:
        r[8] = 'Other projections'
groups = sorted({r[8] for r in out}, key=lambda g: (g != 'Geographic', g == 'Other projections', g))
for r in out:
    r[8] = groups.index(r[8])
path = os.path.join(os.path.dirname(__file__), '.crs-candidates.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump({'epsg': meta.get('EPSG.VERSION'), 'proj': meta.get('PROJ.VERSION'), 'groups': groups, 'crs': out}, f, ensure_ascii=False)
print(f'{len(out)} CRSs -> {path}')
