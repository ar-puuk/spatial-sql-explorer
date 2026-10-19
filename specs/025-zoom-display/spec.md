# Spec 025: layer visibility and sizes by zoom

Status: built, 2026-10-19 (user request, with the GTFS work; STYLE scope: it changes how a result is drawn, not what it is).

## Goal
A person can choose the map zoom levels a layer shows in, and can have marker and line sizes follow the zoom, so a dense layer reads at a city view and detail appears as they zoom in.

## What it does
- **Zoom** (top of the style panel, a row like Opacity): a slider with two handles, the layer showing from the first zoom up to, not including, the second; the numbers beside it say the same. 0 and 24 mean no limit. The handles never cross: the one you move pushes the other, one zoom away. The map's current zoom is a dark flag with its value (one decimal) above the track and a thin line down through the track at that zoom; both turn to a quiet outline when the layer is hidden at it. No sentence, no scale. Every map layer of the result (fills, outlines, lines, arrows, markers, clusters, heatmap, labels) gets MapLibre's own `minzoom` and `maxzoom`.
- **Sizes follow zoom** (Appearance section): marker radius and outline width are a fraction (10% to 95%) of their value at the first zoom and below, lines a separate fraction, growing in a straight line to full size at the second zoom. Defaults when switched on: zoom 10 to 14, half size. Selected and hovered sizes follow too.
- Zoom is the map's (0 world, 14 city, 18 street), the numbers the basemap and the labels (`minZoom`, spec 024) use.

## Where it is kept
- `LayerStyle.zoom` (`packages/core/src/style/zoom.ts`: `{ min?, max?, sizes?: { fromZoom, toZoom, factor, lineFactor? } }`), part of the style like any other: the style panel, a saved QGIS `.qml` (our JSON entry, and QGIS's own scale-based visibility attributes `minScale` and `maxScale` computed for Web Mercator at the equator, so QGIS shows the layer in the same range; a QML that only has those is read back as a range), a Mapbox GL style (layer `minzoom` and `maxzoom`, sizes as zoom curves), and the share link. SLD cannot hold it (the export says so).
- A GTFS feed starts with sizes that follow the zoom (spec 024): stops a third of their size and lines 60% at zoom 10 and below, full from zoom 14.

## Not included
Per-class or per-geometry ranges, a range for labels alone (labels have their own `minZoom`), zoom ranges in SLD, sizes that follow the zoom in a print layout (the page is drawn at the zoom the map is at).
