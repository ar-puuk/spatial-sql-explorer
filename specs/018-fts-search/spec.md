# Spec 018: Search by words (fts)

**Status:** built (2026-10-17), branch `018-fts-search`. **Request (user):** an interface for the `fts` extension loaded in spec 017.
**Decision (user, 2026-10-17):** a "Words" mode in the search box (not a SQL helper, not a column filter).

## Purpose
The search box finds values that contain the typed text. Layers with prose (descriptions, notes, comments) need a word search: every
word, any form (stemming), best match first.

## Behavior
- A Words switch sits in the search box when the displayed result has text columns and `fts` is loaded.
- With it on, the list shows the rows with every typed word, ranked by BM25, one row each, showing the column that holds a word.
  Choosing a row selects it, as for any hit. The column filters and the shape filter apply.
- The index is built on the first search of a result ("Indexing the text of ..."), again for the next result.
- Plain search is unchanged when the switch is off.

## Out of scope
Phrase search, fuzzy matching, other languages' stemmers, writing the search as SQL (the policy refuses PRAGMA, and the index is the app's).

## Spike (2026-10-17)
In the real WASM engine: `PRAGMA create_fts_index` works on a TEMP table, schema `fts_main_<table>` appears, `match_bm25` ranks
("united": United Kingdom first). Dropping the table leaves the schema, so the app drops the index first.
