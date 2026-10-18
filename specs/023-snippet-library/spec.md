# Spec 023: Snippet library

**Status:** built (2026-10-18), branch `023-snippet-library`. **Request (user):** the snippet library, after an example of it was shown (a menu of editable SQL snippets such as buffer, spatial join, nearest, dissolve).

## Behavior
- A **Snippets** button (library icon) in the query panel's header, next to Query history, opens a popover: a search box, then the ready-made queries that fit the open layer, grouped
  as Reshape, Measure, Select, Summarize and Combine. The one under the cursor shows its SQL below the list. Arrow keys move (the search box keeps focus: the combobox pattern),
  Enter or a click chooses, Esc closes and gives the button its focus back.
- A snippet is a **complete query for this layer**, written with the file's own table name (`us_counties`), the layer's geometry column and, where it needs one, its first number or text
  column. Choosing one **replaces the editor's text** (Ctrl+Z brings the old query back); its few values (the distance, the column, a limit) are **editor fields**: the first is selected,
  Tab moves to the next, Esc leaves them. It is not run: the user reads it, changes it and presses Run, as with the Bin and Dot density queries.
- Which snippets a layer is offered follows its geometry (a mixed layer gets all) and its columns (no number column: no "largest by a column"). 24 snippets:
  - **Reshape:** buffer, centroids, bounding boxes, convex hulls, simplify, polygon outlines as lines, dissolve everything, dissolve by a column, repair invalid shapes.
  - **Measure:** area in km², length in km, value per km², vertex count, distance from a point, add longitude and latitude.
  - **Select:** inside a box, largest by a column, text contains, random sample, invalid shapes.
  - **Summarize:** count by value, statistics of a number column.
  - **Combine** (another file of the workspace, by its path from the workspace root, as in any query; the first other file is the default): join attributes by location, count features in each polygon of another file, nearest feature, clip.
- Distances and tolerances follow the layer: degrees (with a first-line comment saying so) for longitude and latitude data, the layer's units for a projected one. Area, length and distance snippets
  convert a projected layer to longitude and latitude first and measure on the spheroid. A snippet that takes coordinates or another file says so in a first comment.
- Every query is checked against the statement policy by a core test, and every snippet that fits a polygon, a line and a point layer is run as written in the real engine by a browser test.

## Findings
- The spheroid functions take longitude, latitude (not flipped): a tenth-of-a-degree square at 47° is 84.5 km². `ST_Distance_Spheroid` takes points (`POINT_2D`), not geometries, so the snippet builds the point from the centroid's X and Y: the engine test found this.
- The editor's snippet syntax has no way to write a brace inside a numbered field, so a column name with a brace is left as plain text (never a Tab stop) rather than changed.
- There is no `ST_ClusterDBSCAN` in this build, so there is no clustering snippet.

## Out of scope
Snippets the user saves or edits as a library, a snippet for every function, snippets that write files, and joins that need a coordinate system change (the combining snippets say that both files must share one).
