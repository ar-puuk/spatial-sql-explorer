# 0.3.0 sidecars (spec 011, T004)

QML files saved by the pre-011 exporter (`exportStyle(..., 'qml', ...)` at
commit 7da529c), one per style in `../pre-011-styles.ts`, for the geometry in
`PRE_011_SIDECAR_GEOMETRY`. They stand in for sidecars users saved with 0.3.0:
spec 011 must import them as the equivalent channels and draw them the same
(US2, SC-002). Written by `tests/core/record-pre-011.test.ts`
(`SE_RECORD_011=1`); do not regenerate after spec 011 changes the style code.
