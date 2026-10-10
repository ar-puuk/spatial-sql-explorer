# Style fixtures (spec 003)

- `categorized.qml` and `graduated.qml` were **written by QGIS 4.2.3**
  (OSGeo4W) through PyQGIS, so they are QGIS's own `renderer-v2` output:
  - categorized: R1, a hidden R2 (`render="false"`), a NULL category and an
    "all other values" category (`value=""`);
  - graduated: 5 quantile ranges on `value`, the third one hidden,
    `<classificationMethod id="Quantile">`.
- `values.json`: the 500 values those styles were computed from (seeded
  log-normal).
- `qgis-breaks.json`: QGIS 4.2.3's equal interval, quantile and Jenks
  classes (k = 5) for `values.json`, computed with no nulls.

To regenerate them, run the spike script described in
`specs/003-thematic-styling/research.md` §1–§3 with
`C:\OSGeo4W\bin\python-qgis.bat <script> <out-dir>`.
