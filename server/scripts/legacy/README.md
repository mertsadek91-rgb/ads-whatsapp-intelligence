# Legacy one-off scripts

These were written against one specific installation's data to perform a
single migration or re-tagging pass. They are kept for reference only.

**They are not supported tooling and are not safe to run against your
database without reading them first** — several issue bulk `UPDATE`s with
assumptions about column contents that may not hold for your install.

Supported scripts live one directory up in `server/scripts/`.
