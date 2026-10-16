// svgcanvas ships no types. Only what printMap.ts uses: a 2D context that draws into an SVG element.
declare module 'svgcanvas' {
  export class Context {
    constructor(width: number, height: number)
    getSvg(): SVGSVGElement
    getSerializedSvg(): string
  }
}
