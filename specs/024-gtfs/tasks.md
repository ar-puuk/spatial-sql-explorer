# Spec 024 tasks

- [x] T001 Research: engine driver spike, gdal3.js spike, real feed measured, GTFS-X style, license (AGPL: design only)
- [x] T002 Constitution 1.6.0
- [x] T003 Fixture feed (`scripts/fixtures-024.mjs`)
- [x] T004 Browser-side measurement of the real feed and a 10x feed; GDAL gets a header-only `stop_times.txt` (constant open), `trips` only for shape-less feeds (research §6)
- [x] T005 Detection + unit tests (core), including the feed-plus-inner-zip case (`gtfs/detect.ts`, `inspectZip` kind `gtfs`, tests/core/gtfs.test.ts; the open path says "not available yet" until T006)
- [ ] T006 Generalize the GDAL host (`list`/`convert`) for GTFS; reader in the web worker and the extension host
- [ ] T007 Routes and stops views, naming, `layer`
- [ ] T008 One-result drawing of routes and stops (decide UNION vs mixed)
- [ ] T009 Default GTFS style, ring-dot marker if needed, QML round trip
- [ ] T010 Open paths in both shells (pick, drop, context menu); no dataset chooser for a confirmed feed
- [ ] T011 SQL fallback (Route B) and its tests
- [ ] T012 Browser + extension tests, accessibility check, CHANGELOG, CLAUDE.md
