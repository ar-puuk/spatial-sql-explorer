# Contract: raster style sidecar (QGIS QML)

File: `<basename>.qml` beside the raster (QGIS loads it automatically). Same decision as the vector sidecar (specs/001-quick-look/design-plan.md §8.5): QGIS's own elements for interchange, plus our full style as JSON so nothing is lost on a round trip.

## Detection
`importStyle` looks at content, not only the extension: root `<qgis>` containing `<rasterrenderer` → raster; containing `<renderer-v2` → vector (unchanged path). A vector QML next to a `.tif`, or a raster QML next to a vector file, is ignored with a note ("this style is for a raster / vector layer").

## Written
```xml
<qgis version="...">
  <pipe>
    <rasterrenderer type="singlebandpseudocolor|multibandcolor|paletted|singlebandgray" band="1" opacity="1"
                    classificationMin="..." classificationMax="..." nodataColor="">
      <!-- singlebandpseudocolor --> <rastershader><colorrampshader colorRampType="INTERPOLATED" classificationMode="1" minimumValue=".." maximumValue=".." clip="0"><item value=".." color="#rrggbb" alpha="255" label=".."/>...</colorrampshader></rastershader>
      <!-- multibandcolor --> <redContrastEnhancement>...</redContrastEnhancement> (min/max per band) with redBand, greenBand, blueBand
      <!-- paletted --> <colorPalette><paletteEntry value=".." color="#rrggbb" alpha="255" label=".."/></colorPalette>
    </rasterrenderer>
    <rasterTransparency><singleValuePixelList>...nodata...</singleValuePixelList></rasterTransparency>
  </pipe>
  <customproperties>
    <Option type="Map"><Option name="spatialExplorer/raster" type="QString" value="{json of RasterStyle}"/></Option>
  </customproperties>
</qgis>
```
- Colormap: the ramp is sampled to 9 to 16 `item`s (the tiler's colormap evaluated at evenly spaced positions) so QGIS draws the same look; our own colormap name is in the JSON.
- Stretch `sqrt`/`log`/`gamma`: not expressible; written to JSON only, and the QML uses the linear ramp with a note (shown on export, like SLD limits).
- Opacity: `opacity` attribute on the renderer.

## Read
1. Our JSON present and valid (after `sanitizeRasterStyle`) → use it.
2. Else QGIS elements: `singlebandpseudocolor` (min, max, first and last colors → nearest named colormap, else `viridis` with a note), `multibandcolor` (bands, per-band min and max), `paletted` (needs a file palette), `singlebandgray` (gray colormap).
3. Else: default style, with a note.
A band index beyond the file's band count → default style with a note.

## Not written
Gamma, saturation, hue, resampling, contrast enhancement types other than linear stretch (QGIS-only features are left as found when the file has them: we only replace the elements we own).

## Verification
`tests/qgis/` loads each fixture's written `.qml` in QGIS 4.2 (`C:\OSGeo4W`) and compares renderer type, band, min, max and 3 sampled ramp colors; and reads a QGIS-authored `.qml` for each renderer type.
