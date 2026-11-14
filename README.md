# Flame in Freefall

NASA Space Apps Challenge 2026

Challenge: Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data

Team: Kenyalang Blue Flame (Bintulu, Malaysia)

Live dashboard: https://flame-in-freefall-three.vercel.app

## Team aim (in the team's own words)

> a dashboard that answers the full objective, not a minimal one.the aim is just not to win but make impact to the NASA. remember i dont like very fancy features as 2 days hackaton is notsufficient to devliver addditional feature.what we aaim is spot on the solution,give value and unique from other competitiors

- George Gabriel Ujai, 14 Nov 2026

## What it does

A web dashboard over the 24 combustion investigations in NASA's Physical Sciences Informatics (PSI) repository:

- Summarizes every investigation: objective, fuels, tested conditions, what varied, publications, NASA flame photos, and key findings quoted word for word from NASA reports.
- Ranks investigations for five crewed environments (ISS, Gateway, Moon base, pressurized rover, Mars base) with a visible, re-weightable score.
- Shows where NASA has and has not tested (Oxygen Gap Map) and lists, per habitat, the conditions still untested.
- Shows which predictive models the data supports, with model-ready CSV/JSON downloads.
- Ask the data: an assistant panel that answers only from the PSI and NTRS documents, with citations.

## Data

- NASA PSI combustion experimental tables: `data/psi_experimental_tables/` (22 CSV files, unmodified).
- Unified table: `data/unified/conditions.csv` (2,009 rows, each with its source file and row).
- Investigation metadata: `data/investigations/investigations_meta.json`.
- Habitat atmospheres with NASA sources: `data/environment_profiles.json`.
- Verified key findings and their source text: `data/findings/`.

## Reproduce

Python 3.12, standard library (Pillow only for images).

```
py -3.12 pipeline/build_unified.py
py -3.12 pipeline/build_site_data.py
py -3.12 pipeline/verify_findings.py
py -3.12 pipeline/audit_unified.py
py -3.12 -m unittest discover -s tests
```

The site in `public/` is static. The Ask function is `api/ask.py` (Vercel Python runtime) and needs `ANTHROPIC_API_KEY`.

## Verification

- Every quoted finding is checked word for word against its NASA source text (`pipeline/verify_findings.py`).
- The unified table is re-checked against the original PSI files (`pipeline/audit_unified.py`).
- Habitat values are either cited to a NASA source or shown as not specified; nothing is assumed.

## Use of Super Intelligence (SI)

SI (Claude, Anthropic) was used to help research the challenge and data sources, write and test code, extract candidate quotes from NASA reports, and draft text. Quotes are machine-checked against their sources and all data processing is plain code with automated tests. The Ask panel uses Claude restricted to the loaded NASA documents. No SI-generated images are used. Video narration, if present, is an SI-generated voice and is labelled as such.

## Disclosure

Before the event, a short private exploration of this challenge topic was done and then deleted on 28 Sep 2026, after reading the Participant FAQ rule that work may not begin before the hackathon. None of that code, data or findings is reused here. All work in this repository starts at the event.

## License

Apache License 2.0, see `LICENSE`. NASA data and documents remain under their own terms as stated on each PSI and NTRS record.
