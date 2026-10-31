# Attribution

## Places data
City names, regions, countries and approximate coordinates in `supabase/migrations/20261104000100_places_seed.sql` come from **GeoNames** (https://www.geonames.org), the `cities15000` dump filtered to cities of 100,000 people or more.
GeoNames data is licensed under **Creative Commons Attribution 4.0** (https://creativecommons.org/licenses/by/4.0/). The data was modified: filtered, trimmed to a few columns, and region names looked up from `admin1CodesASCII`.
Rebuild or widen the list with `python scripts/build-places-seed.py <folder> [min_population]`.
