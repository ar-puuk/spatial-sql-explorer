// The lowest and highest value of a bivariate axis, short (12K, 5.9): the ends marked on the legend, on the map and on the page.
export function axisEnds(ranges: ReadonlyArray<{ lower: number; upper: number }>): [string, string] | undefined {
  if (!ranges.length) return undefined
  const f = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })
  return [f.format(ranges[0].lower), f.format(ranges[ranges.length - 1].upper)]
}
