# Spec 022: Dot density

**Status:** built (2026-10-18), branch `022-dot-density`. **Request (user):** dot density, the last item of the 2026-10-17 list.

## Behavior
- The map control **Dot density…** (tools group, polygon layers with a number column) opens a dialog over the map's top left, like Bin into cells. **Draw**: one
  to six number columns, each its own color. **One dot**: what a dot stands for, from a 1, 2, 5, 10, 20, … list that runs up to the total; it is first chosen
  to give about 5,000 dots and chosen again when the columns change. The dialog says about how many dots that is.
- The query is the product, as for the bin: the SQL tab holds it, it can be edited and rerun, and the result is an ordinary points layer
  (`feature, category, one_dot, geom`), so the table, style panel and exports work. A fresh result opens with small dots colored by `category`
  and the legend titled "One dot = N"; a rerun keeps the user's style. Esc puts the old query, result and style back.
- A polygon with a value of 12,000 and 500 per dot gets 24 dots at random places inside it. A remainder is one more dot with that chance (a polygon with 1.3 dots
  gets 2 three times in ten), so small polygons are not all rounded away and the total stays right. Zero, negative and missing values, and polygons with no
  usable shape, get none. The rows are those the layer shows (column filters and shape filter, as for the bin).
- Limits (user decision 2026-10-17: a quick-look tool): the preview draws up to 20,000 dots; over 100,000 the dialog asks first; over 1,000,000 it refuses and says to let one dot stand for more.
- Not built: "selected rows only" (the filters and shape filter narrow the polygons), dots by group inside a polygon from a text column, a barrier layer (dots kept off water), mapping the amount per dot to the zoom.

## Findings from the spike (the real engine; why it is built this way)
- `ST_GeneratePoints` exists but is a table function over a box, with a constant count: it cannot take a polygon, nor one count per row.
- So the query **samples the polygon's box and keeps the points that fall inside** (`ST_Within`), taking the first `n` of them: for each polygon it makes
  `(1.5 n + 4 sqrt(n) + 6) / fill` candidates (`fill` is the polygon's area over its box, at least 0.005), so the polygon almost surely yields `n`.
  Measured: 2,000 polygons, 199,000 dots, 0.7 s, every polygon complete; 3,000 polygons with 60 vertices and 300,000 dots, 1 s.
- The "random" numbers are `hash(feature, column, k)`, so the same layer always gives the same map, and the dots of a polygon keep their places while more are asked for.
- The cost is vertices times candidates: 20 polygons with 50,000 vertices and 20,000 dots took 14 s (100 polygons of 5,000 vertices, 1.5 s). Very detailed
  polygons are slow; the preview limit and the ask-first limit are in dots, not in vertices.
- Points are placed uniformly in longitude and latitude (the polygon is converted to WGS84 first for a projected layer), which differs from equal area
  by the cosine of the latitude across one polygon: invisible at the size of a polygon people count in.

## Out of scope
Polygons crossing the date line (read as outside the world, as for the bin), dots on the sphere, any weighting, and edits to the data.
