---
lat:
  require-code-mention: true
---
# Section Parsing

## Builds a section tree from nested headings

Parse a markdown file with nested headings and verify the resulting tree has correct ids, depths, parent-child relationships, and file stems.

## Populates position and body fields

Verify that `startLine`, `endLine`, and `body` are correctly extracted from heading positions and first-paragraph text.

## Renders inline code in body

Verify that inline code (backtick-wrapped) in a paragraph is preserved in the section `body` field.

## Renders wiki links in body

Verify that wiki links in a paragraph are rendered as `[[target]]` in the section `body` field.
