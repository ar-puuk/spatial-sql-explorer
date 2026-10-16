// Spec 016: the print layout's page geometry, scale and furniture. Ported from GeoLibre (opengeos/GeoLibre, MIT,
// © 2026 Qiusheng Wu): tests/print-layout.test.ts. Their legend tests are about GeoLibre's own layer-derived legend, which
// is ours (the legend editor and mapImage.ts); the attribution text is ours.
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  computeScaleRatio,
  drawLayout,
  mapBodyAspectRatio,
  pageMm,
  pagePx,
  resolvePageSize,
  scaleZoomTarget,
  type LayoutOptions,
} from "../../packages/ui/src/print/layout";

/**
 * A minimal recording stand-in for a 2D canvas context. Every drawing method is
 * a no-op except `measureText` (returns a fixed width) and `fillText`, which
 * records the alignment in effect at the moment of the draw so tests can assert
 * how text was anchored.
 */
function recordingCanvas(): {
  canvas: HTMLCanvasElement;
  fills: { text: string; x: number; y: number; textAlign: string; textBaseline: string }[];
  fillRects: { w: number; h: number; fillStyle: string }[];
  imageBoxes: { w: number; h: number }[];
  arcs: number;
  /** Live count of `drawImage` calls. */
  readonly drawImages: number;
  polylines: number[];
} {
  const fills: {
    text: string;
    x: number;
    y: number;
    textAlign: string;
    textBaseline: string;
  }[] = [];
  // Filled rectangles (swatches, chart bars), with the fill colour in effect.
  const fillRects: { w: number; h: number; fillStyle: string }[] = [];
  // Drawn images (custom SVG marker icons), with the box each was drawn into,
  // so a proportional marker ramp's graduated sizes can be asserted.
  const imageBoxes: { w: number; h: number }[] = [];
  // Stroked polylines: one entry per beginPath..stroke sequence that used
  // lineTo, holding the segment count (the line chart's path).
  const polylines: number[] = [];
  const counters = { arcs: 0, pendingLines: 0, drawImages: 0 };
  const state: Record<string, unknown> = {
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "fillText") {
        return (text: string, x: number, y: number) =>
          fills.push({
            text,
            x,
            y,
            textAlign: String(target.textAlign),
            textBaseline: String(target.textBaseline),
          });
      }
      if (prop === "fillRect") {
        return (_x: number, _y: number, w: number, h: number) =>
          fillRects.push({ w, h, fillStyle: String(target.fillStyle) });
      }
      if (prop === "arc") {
        return () => {
          counters.arcs += 1;
        };
      }
      if (prop === "drawImage") {
        return (_img: unknown, _x: number, _y: number, w: number, h: number) => {
          counters.drawImages += 1;
          imageBoxes.push({ w, h });
        };
      }
      if (prop === "beginPath") {
        return () => {
          counters.pendingLines = 0;
        };
      }
      if (prop === "lineTo") {
        return () => {
          counters.pendingLines += 1;
        };
      }
      if (prop === "stroke") {
        return () => {
          if (counters.pendingLines > 0) polylines.push(counters.pendingLines);
          counters.pendingLines = 0;
        };
      }
      if (prop in target) return target[prop as string];
      // Any other method (save, restore, clip, ...) is a no-op.
      return () => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  const canvas = {
    width: 400,
    height: 400,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    fills,
    fillRects,
    imageBoxes,
    get arcs() {
      return counters.arcs;
    },
    get drawImages() {
      return counters.drawImages;
    },
    polylines,
  };
}


function baseOptions(overrides: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    title: "Map",
    subtitle: "",
    paperSize: "a4",
    orientation: "landscape",
    showTitle: true,
    showLegend: false,
    showScaleBar: false,
    showNorthArrow: false,
    showFooter: false,
    footerText: "",
    legend: null,
    metersPerPixel: 0,
    bearingDeg: 0,
    mapImage: null,
    mapImageWidth: 0,
    mapImageHeight: 0,
    ...overrides,
  };
}

describe("resolvePageSize", () => {
  it("swaps width/height for landscape preset paper", () => {
    const portrait = resolvePageSize({
      paperSize: "a4",
      orientation: "portrait",
    });
    assert.deepEqual(portrait, { width: 210, height: 297, unit: "mm" });
    const landscape = resolvePageSize({
      paperSize: "a4",
      orientation: "landscape",
    });
    assert.deepEqual(landscape, { width: 297, height: 210, unit: "mm" });
  });

  it("resolves a pixel screen preset to its oriented pixel dimensions", () => {
    const landscape = resolvePageSize({
      paperSize: "fullhd",
      orientation: "landscape",
    });
    assert.deepEqual(landscape, { width: 1920, height: 1080, unit: "px" });
  });

  it("takes custom dimensions verbatim, ignoring orientation", () => {
    const size = resolvePageSize({
      paperSize: "custom",
      orientation: "landscape",
      customSize: { width: 800, height: 600, unit: "px" },
    });
    assert.deepEqual(size, { width: 800, height: 600, unit: "px" });
  });

  it("falls back to a sane default for an incomplete custom size", () => {
    const size = resolvePageSize({
      paperSize: "custom",
      orientation: "portrait",
      customSize: { width: 0, height: 0, unit: "px" },
    });
    assert.deepEqual(size, { width: 1280, height: 720, unit: "px" });
  });
});

describe("mapBodyAspectRatio", () => {
  it("accounts for an outside title when fitting the atlas camera", () => {
    const inside = mapBodyAspectRatio(
      baseOptions({
        titlePlacement: "inside",
        showAttribution: false,
        showDate: false,
      }),
    );
    const outside = mapBodyAspectRatio(
      baseOptions({
        titlePlacement: "outside",
        showAttribution: false,
        showDate: false,
      }),
    );
    assert.ok(outside > inside);
  });
});

describe("pageMm / pagePx", () => {
  it("passes millimetre sizes through and scales by dpi for pixels", () => {
    assert.deepEqual(pageMm({ width: 210, height: 297, unit: "mm" }), {
      widthMm: 210,
      heightMm: 297,
    });
    assert.deepEqual(pagePx({ width: 1920, height: 1080, unit: "px" }, 150), {
      width: 1920,
      height: 1080,
    });
    // A4 portrait at 150 dpi: 210 mm * 150 / 25.4 ≈ 1240 px.
    assert.deepEqual(pagePx({ width: 210, height: 297, unit: "mm" }, 150), {
      width: 1240,
      height: 1754,
    });
  });

  it("treats screen pixels as 96-dpi millimetres", () => {
    const { widthMm } = pageMm({ width: 96, height: 96, unit: "px" });
    assert.ok(Math.abs(widthMm - 25.4) < 1e-6, "96 px at 96 dpi is one inch");
  });
});


describe("drawLayout cartographic furniture", () => {
  it("right-aligns the title when titleAlign is right", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(canvas, baseOptions({ title: "Atlas", titleAlign: "right" }));
    const title = fills.find((f) => f.text === "Atlas");
    assert.ok(title, "expected the title to be drawn");
    assert.equal(title.textAlign, "right");
  });

  it("draws the map credit on the left, and the footer text and the date on the right", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showAttribution: true,
        attributionText: "MapLibre | © OpenFreeMap © OpenStreetMap contributors",
        showDate: true,
        dateText: "2026-06-19",
        showFooter: true,
        footerText: "My Org",
      }),
    );
    // MapLibre is set apart from the basemap's credit after it.
    const lead = fills.find((f) => f.text === "MapLibre");
    assert.ok(lead, "expected the renderer's name to be drawn");
    assert.equal(lead.textAlign, "left");
    const credit = fills.find((f) => f.text.startsWith("© OpenFreeMap"));
    assert.ok(credit, "expected the basemap's credit to be drawn");
    assert.equal(credit.textAlign, "left");
    assert.ok(credit.x > lead.x, "the credit follows the name");
    const date = fills.find((f) => f.text === "2026-06-19");
    assert.ok(date, "expected the date to be drawn");
    assert.equal(date.textAlign, "right");
    const footer = fills.find((f) => f.text === "My Org");
    assert.ok(footer, "expected the custom footer text to be drawn");
    assert.equal(footer.textAlign, "right");
    assert.ok(footer.x < date.x, "the footer text sits before the date");
  });

  it("omits the attribution when showAttribution is false, or when there is no credit", () => {
    const off = recordingCanvas();
    drawLayout(off.canvas, baseOptions({ showAttribution: false, attributionText: "MapLibre" }));
    assert.ok(!off.fills.some((f) => f.text === "MapLibre"));
    const none = recordingCanvas();
    drawLayout(none.canvas, baseOptions({}));
    assert.ok(!none.fills.some((f) => /MapLibre|Created with/.test(f.text)));
  });

  it("draws a 1:N scale ratio for a millimetre paper size", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showScaleBar: true,
        metersPerPixel: 10,
        mapImage: {} as CanvasImageSource,
        mapImageWidth: 400,
        mapImageHeight: 400,
      }),
    );
    assert.ok(
      fills.some((f) => /^1:/.test(f.text)),
      "expected a representative-fraction label",
    );
  });

  it("labels the scale bar in metric by default", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showScaleBar: true,
        metersPerPixel: 10,
        mapImage: {} as CanvasImageSource,
        mapImageWidth: 400,
        mapImageHeight: 400,
      }),
    );
    assert.ok(
      fills.some((f) => /^\d[\d.]* (km|m|cm)$/.test(f.text)),
      "expected a metric distance label (km/m/cm)",
    );
    assert.ok(
      !fills.some((f) => /(mi|ft|nmi)$/.test(f.text)),
      "did not expect an imperial/nautical label under metric",
    );
  });

  it("labels the scale bar in imperial when scaleUnit is imperial", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showScaleBar: true,
        scaleUnit: "imperial",
        metersPerPixel: 10,
        mapImage: {} as CanvasImageSource,
        mapImageWidth: 400,
        mapImageHeight: 400,
      }),
    );
    assert.ok(
      fills.some((f) => /^\d[\d.]* (mi|ft)$/.test(f.text)),
      "expected an imperial distance label (mi/ft)",
    );
    assert.ok(
      !fills.some((f) => /(km|nmi)$/.test(f.text) || / m$| cm$/.test(f.text)),
      "did not expect a metric/nautical label under imperial",
    );
  });

  it("labels the scale bar in nautical miles when scaleUnit is nautical", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showScaleBar: true,
        scaleUnit: "nautical",
        metersPerPixel: 10,
        mapImage: {} as CanvasImageSource,
        mapImageWidth: 400,
        mapImageHeight: 400,
      }),
    );
    assert.ok(
      fills.some((f) => /^\d[\d.]* nmi$/.test(f.text)),
      "expected a nautical-mile distance label (nmi)",
    );
  });

  it("does not draw a scale ratio for a pixel screen size", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        paperSize: "fullhd",
        showScaleBar: true,
        metersPerPixel: 10,
        mapImage: {} as CanvasImageSource,
        mapImageWidth: 400,
        mapImageHeight: 400,
      }),
    );
    assert.ok(!fills.some((f) => /^1:/.test(f.text)));
  });

  it("draws the info block rows when showInfoBlock and fields are set", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(
      canvas,
      baseOptions({
        showInfoBlock: true,
        author: "Jane Cartographer",
        projectNumber: "PRJ-42",
        crs: "EPSG:28992",
        revision: "Rev 01",
        infoLabels: {
          author: "Author",
          project: "Project",
          crs: "CRS",
          revision: "Rev",
        },
      }),
    );
    for (const v of ["Jane Cartographer", "PRJ-42", "EPSG:28992", "Rev 01"]) {
      assert.ok(
        fills.some((f) => f.text === v),
        `expected the info block to draw "${v}"`,
      );
    }
  });

  it("omits the info block when showInfoBlock is false", () => {
    const { canvas, fills } = recordingCanvas();
    drawLayout(canvas, baseOptions({ author: "Hidden Author" }));
    assert.ok(!fills.some((f) => f.text === "Hidden Author"));
  });
});

describe("computeScaleRatio", () => {
  const withMap = (overrides: Partial<LayoutOptions> = {}): LayoutOptions =>
    baseOptions({
      metersPerPixel: 10,
      mapImage: {} as CanvasImageSource,
      mapImageWidth: 400,
      mapImageHeight: 400,
      ...overrides,
    });

  it("returns 0 for a pixel/screen page (no physical scale)", () => {
    assert.equal(computeScaleRatio(withMap({ paperSize: "fullhd" })), 0);
  });

  it("returns 0 when there is no captured map", () => {
    assert.equal(computeScaleRatio(baseOptions({ metersPerPixel: 10, mapImage: null })), 0);
  });

  it("returns a positive representative fraction for a millimetre page", () => {
    const ratio = computeScaleRatio(withMap());
    assert.ok(ratio > 0 && Number.isFinite(ratio));
  });

  it("scales linearly with metres-per-pixel (the basis of the zoom math)", () => {
    // The scale denominator is linear in metres-per-pixel, which halves per zoom
    // level, so applyScale derives its zoom delta as log2(current / target).
    const a = computeScaleRatio(withMap({ metersPerPixel: 10 }));
    const b = computeScaleRatio(withMap({ metersPerPixel: 20 }));
    assert.ok(Math.abs(b / a - 2) < 1e-9, "doubling mpp doubles the ratio");
  });
});

/**
 * A recording context that captures every `strokeRect` with the stroke style and
 * line width in effect at the moment of the draw, so tests can assert how the
 * map frame border (GH #749) is rendered.
 */
function strokeRecordingCanvas(): {
  canvas: HTMLCanvasElement;
  strokes: { x: number; w: number; strokeStyle: string; lineWidth: number }[];
} {
  const strokes: {
    x: number;
    w: number;
    strokeStyle: string;
    lineWidth: number;
  }[] = [];
  const state: Record<string, unknown> = { strokeStyle: "", lineWidth: 0 };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "strokeRect") {
        return (x: number, _y: number, w: number) =>
          strokes.push({
            x,
            w,
            strokeStyle: String(target.strokeStyle),
            lineWidth: Number(target.lineWidth),
          });
      }
      if (prop in target) return target[prop as string];
      return () => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  const canvas = {
    width: 400,
    height: 400,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, strokes };
}

describe("drawLayout map frame border (GH #749)", () => {
  // These constants follow directly from computeBodyRect on a 400×400 canvas
  // with the default "normal" margin: unit = min(400,400)/100 = 4, margin =
  // unit*5 = 20, so bodyX = 20 and bodyW = 400 - 40 = 360 (> 200). If the unit
  // formula or default margin changes, update these values.
  const isBodyBorder = (s: { x: number; w: number }) => s.x === 20 && s.w > 200;

  it("draws the frame in the chosen colour and thickness", () => {
    const { canvas, strokes } = strokeRecordingCanvas();
    drawLayout(canvas, baseOptions({ mapBorderColor: "#123456", mapBorderWidth: 5 }));
    const frame = strokes.find((s) => isBodyBorder(s) && s.strokeStyle === "#123456");
    assert.ok(frame, "expected the map frame to use the custom colour");
    assert.ok(frame.lineWidth > 1, "expected a thicker frame for width 5");
  });

  it("hides the frame when the thickness is 0", () => {
    const { canvas, strokes } = strokeRecordingCanvas();
    drawLayout(canvas, baseOptions({ mapBorderWidth: 0 }));
    assert.ok(!strokes.some(isBodyBorder), "expected no map frame stroke when width is 0");
  });
});


describe("scaleZoomTarget (#2475, GH #743)", () => {
  it("halves the ground scale per zoom level", () => {
    const target = scaleZoomTarget(10, 100_000, 50_000, 0, 24);
    assert.ok(target);
    assert.equal(target.zoom, 11);
    assert.equal(target.clamped, false);
    assert.equal(target.unchanged, false);
    // And back out again.
    assert.equal(scaleZoomTarget(10, 100_000, 400_000, 0, 24)?.zoom, 8);
  });
  it("reports a request the map cannot reach as clamped", () => {
    // 1:1 from 1:100,000 is ~17 levels in; a map capped at 14 cannot get there.
    const target = scaleZoomTarget(10, 100_000, 1, 0, 14);
    assert.ok(target);
    assert.equal(target.zoom, 14);
    assert.equal(target.clamped, true, "the notice must fire on every renderer");
    assert.equal(target.unchanged, false);
    const out = scaleZoomTarget(10, 100_000, 1e12, 5, 24);
    assert.equal(out?.zoom, 5);
    assert.equal(out?.clamped, true);
  });
  it("flags a no-op so the caller recaptures without moving the camera", () => {
    const same = scaleZoomTarget(10, 100_000, 100_000, 0, 24);
    assert.equal(same?.unchanged, true);
    assert.equal(same?.clamped, false);
    // Already pinned at the ceiling: clamped *and* a no-op, so a MapLibre map
    // would never emit the "idle" the recapture waits for.
    const pinned = scaleZoomTarget(24, 100_000, 1, 0, 24);
    assert.equal(pinned?.zoom, 24);
    assert.equal(pinned?.clamped, true);
    assert.equal(pinned?.unchanged, true);
  });
  it("prefers minZoom when a map reports limits the wrong way round", () => {
    assert.equal(scaleZoomTarget(10, 100_000, 50_000, 12, 8)?.zoom, 12);
  });
  it("returns null rather than a NaN zoom for unusable inputs", () => {
    assert.equal(scaleZoomTarget(10, 0, 50_000, 0, 24), null);
    assert.equal(scaleZoomTarget(10, 100_000, 0, 0, 24), null);
    assert.equal(scaleZoomTarget(10, 100_000, -5, 0, 24), null);
    assert.equal(scaleZoomTarget(Number.NaN, 100_000, 50_000, 0, 24), null);
    assert.equal(scaleZoomTarget(10, 100_000, 50_000, Number.NaN, 24), null);
    assert.equal(scaleZoomTarget(10, 100_000, 50_000, 0, Number.POSITIVE_INFINITY), null);
  });
  it("rejects an infinite ratio instead of pinning the camera to a limit", () => {
    // A long enough digit string parses to Infinity, which passes `> 0` and
    // would otherwise send `wanted` to -Infinity and the camera to minZoom.
    assert.equal(scaleZoomTarget(10, 100_000, Number.POSITIVE_INFINITY, 0, 24), null);
    assert.equal(scaleZoomTarget(10, Number.POSITIVE_INFINITY, 50_000, 0, 24), null);
    assert.equal(scaleZoomTarget(10, 100_000, Number("1".repeat(400)), 0, 24), null);
  });
});
