---
lat:
  require-code-mention: true
---
# Locate

## Finds sections by exact id

Given a full section path query (case-insensitive), `findSections` returns the matching section with correct metadata.

## Matches subsection by trailing segment

Given a query matching only a trailing segment (e.g. `Running Tests`), `findSections` returns sections whose id ends with that segment.

## Fuzzy matches with typos

Given a query with a typo (e.g. `Runing Tests`), `findSections` returns the closest match via edit distance.
