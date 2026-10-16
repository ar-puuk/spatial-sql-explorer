// svgcanvas ships no types. What print/svg.ts uses: a 2D context that draws into an SVG element.
declare module 'svgcanvas' {
  export interface Context extends CanvasRenderingContext2D {
    getSvg(): SVGSVGElement
    getSerializedSvg(): string
  }
  export const Context: new (width: number, height: number) => Context
}
