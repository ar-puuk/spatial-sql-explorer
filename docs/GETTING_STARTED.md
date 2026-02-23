# Getting Started with Spatial SQL Explorer

## Quick Start

### 1. Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge)
- No server or installation required
- Works entirely in your browser

### 2. Running the Application

Simply open `index.html` in your web browser:
```bash
# Option 1: Direct file opening
open index.html

# Option 2: Using a local server (recommended)
python -m http.server 8000
# Then visit: http://localhost:8000
```

**Note:** Due to browser security restrictions, some features work better with a local server. We recommend using Python's built-in server or any simple HTTP server.

### 3. First Query

When the app loads, you'll see:
- **Left Panel**: CodeMirror SQL editor with a sample query
- **Center Panel**: MapLibre GL map showing demo data
- **Right Panel**: Empty results area

Click the **Run Query** button (or press `Ctrl+Enter`) to execute the example query.

## Understanding the Interface

### Left Panel: SQL Editor

**Toolbar:**
- **Run Query** (▶): Execute your SQL query
- **Clear** (✕): Clear the editor

**Editor Features:**
- Write SQL queries with full syntax highlighting
- Line numbers on the left
- Code folding for better readability
- Auto-indentation and bracket matching

**Query History:**
- Your last 20 queries appear below the editor
- Click any query to restore it
- History persists across sessions (stored in browser)

**Status Bar:**
- Shows character count and line count
- Updates in real-time as you type

### Center Panel: Map

**Features:**
- Interactive map with Carto Voyager basemap
- **Demo data layer** (light colored points) showing sample GeoJSON features
- **Query results layer** (blue points) automatically displayed when you run a spatial query
- **Navigation controls** (zoom, compass) in the top-right

**Interactions:**
- Click on any point to see its properties
- Hover over points to see cursor change
- Scroll to zoom, drag to pan
- Click compass to reset orientation

**Auto-Fit:**
- When you run a query with geographic results, the map automatically centers on those results
- Padding is added to keep results visible

### Right Panel: Results

**Results Table:**
- Displays query results in a formatted table
- Shows all columns from your query
- First 100 rows displayed (for performance)
- Null values shown in gray

**Status Bar:**
- **Result count**: Number of rows returned
- **Query time**: How long the query took to execute

**Error Display:**
- If a query fails, the error message appears here in red
- Helpful for debugging SQL syntax errors

## Example Queries

### Get All Features
```sql
SELECT * FROM demo_features LIMIT 10;
```

### Filter by Confidence
```sql
SELECT id, name, confidence, longitude, latitude
FROM demo_features
WHERE confidence > 0.5
ORDER BY confidence DESC;
```

### Aggregate Statistics
```sql
SELECT 
  COUNT(*) as total_features,
  AVG(confidence) as average_confidence,
  MIN(confidence) as min_confidence,
  MAX(confidence) as max_confidence
FROM demo_features;
```

### Geographic Bounds
```sql
SELECT *
FROM demo_features
WHERE longitude BETWEEN -97 AND -96
  AND latitude BETWEEN 32 AND 33;
```

### Group By Analysis
```sql
SELECT 
  geometry_type,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM demo_features
GROUP BY geometry_type;
```

## Demo Data Structure

The `demo_features` table contains:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Unique feature identifier |
| `name` | VARCHAR | Feature name |
| `confidence` | DOUBLE | Confidence score (0-1) |
| `longitude` | DOUBLE | X coordinate (decimal degrees) |
| `latitude` | DOUBLE | Y coordinate (decimal degrees) |
| `geometry_type` | VARCHAR | Geometry type (e.g., "Point") |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` (Windows/Linux) | Run query |
| `Cmd+Enter` (macOS) | Run query |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+F` | Find |
| `Ctrl+/` | Toggle comment |
| `Tab` | Indent |
| `Shift+Tab` | Outdent |

## Workflow Tips

### 1. Start Simple
```sql
-- Begin with a simple SELECT to understand the data
SELECT * FROM demo_features LIMIT 5;
```

### 2. Add Filters
```sql
-- Then add WHERE clauses to filter
SELECT * FROM demo_features WHERE confidence > 0.7;
```

### 3. Refine Selection
```sql
-- Select only needed columns for clarity
SELECT id, name, confidence, longitude, latitude
FROM demo_features
WHERE confidence > 0.7;
```

### 4. Sort Results
```sql
-- Add ORDER BY to organize results
SELECT id, name, confidence, longitude, latitude
FROM demo_features
WHERE confidence > 0.7
ORDER BY confidence DESC;
```

### 5. Aggregate Data
```sql
-- Use aggregation for summary statistics
SELECT 
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM demo_features
GROUP BY name;
```

## Troubleshooting

### Map Not Showing
- Make sure you're running on a local server (not opening `index.html` directly)
- Check browser console (F12) for errors
- Ensure internet connection (basemap loads from CDN)

### Query Errors
- Check SQL syntax (DuckDB supports standard SQL)
- Verify table name is `demo_features`
- Ensure column names are correct
- Check for typos in WHERE clauses

### Results Not Showing on Map
- Results must have `latitude` and `longitude` columns
- Values must be valid numbers (not NULL)
- Check that coordinates are in decimal degrees (not feet/meters)

### History Not Saving
- Browser must allow localStorage (check privacy settings)
- Clear browser cache if history appears broken
- History is per-domain (won't transfer between sites)

## Advanced Features

### Using Aliases
```sql
SELECT 
  id as feature_id,
  name as feature_name,
  confidence as confidence_score
FROM demo_features;
```

### Case-Insensitive Searches
```sql
SELECT * FROM demo_features 
WHERE name ILIKE '%park%';
```

### Numeric Comparisons
```sql
SELECT * FROM demo_features 
WHERE confidence BETWEEN 0.5 AND 0.9;
```

### NULL Handling
```sql
SELECT * FROM demo_features 
WHERE name IS NOT NULL;
```

## Performance Notes

- **Small queries** (< 100 rows): Instant
- **Medium queries** (100-1000 rows): < 100ms
- **Large queries** (1000+ rows): May take longer, first 100 rows displayed
- **Aggregations**: Very fast even on larger datasets

## Browser Storage

- **Query History**: Stored in browser localStorage
- **Limit**: Last 20 queries
- **Persistence**: Until browser data is cleared
- **Privacy**: Stored locally, never sent to a server

## Security Notes

- **100% Client-Side**: No data leaves your browser
- **No Server**: No backend processing
- **DuckDB-WASM**: Runs entirely in your browser
- **Safe**: Your data never connects to external services

## Next Steps

1. **Explore the demo data**
   - Run simple queries to understand the schema
   - View different columns and filters

2. **Try the map interaction**
   - Click on features to see popups
   - Notice how results center the map

3. **Build complex queries**
   - Combine filters and aggregations
   - Use ORDER BY and GROUP BY

4. **Check the console**
   - Open browser developer tools (F12)
   - See helpful logging messages
   - Debug any issues

## Getting Help

### Check Console Logs
Open browser DevTools (F12 → Console tab) to see:
- Application initialization status
- Query execution details
- Any errors or warnings
- Performance metrics

### Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| Map appears blank | Ensure local server is running |
| Query runs but no map update | Check if results have latitude/longitude |
| Editor not responding | Refresh the page |
| History not loading | Clear browser cache |

## Resources

- **DuckDB Documentation**: https://duckdb.org/docs/
- **MapLibre Documentation**: https://maplibre.org/maplibre-gl-js/docs/
- **SQL Tutorial**: https://www.w3schools.com/sql/

## Project Structure

```
spatial-sql-explorer/
├── index.html          # Main HTML file - open this!
├── css/
│   └── style.css      # All styling
├── js/
│   └── app.js         # Main application logic
├── data/
│   └── demo.geojson   # Sample spatial data
├── docs/
│   ├── GETTING_STARTED.md  # This file
│   └── API.md              # API reference (coming soon)
└── README.md          # Project overview
```

## Tips for Best Experience

✅ **Do This:**
- Use a local server (http://localhost:...)
- Test with simple queries first
- Check browser console for helpful messages
- Keep queries under 10,000 rows for best performance
- Use LIMIT to cap result sets

❌ **Avoid This:**
- Opening file:// directly in browser (use local server)
- Very large result sets (use LIMIT and WHERE)
- Invalid SQL syntax (check DuckDB docs)
- Assuming server-side processing (it's all client-side)

---

**Happy querying!** 🗺️📊

For more details, see the [Implementation Summary](./IMPLEMENTATION_SUMMARY.md).