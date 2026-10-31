/* A tiny places directory for the in-memory fakes and the dev UI harness. The real directory is the GeoNames table in the database.
   Coordinates exist only here (fakes need them to compute a distance range); the PlaceHit given to screens never has any. */
import { haversineKm, type PlaceHit } from './dating';

export interface FakePlace extends PlaceHit { id: number; lat: number; lng: number }
const p = (id: number, name: string, region: string, countryCode: string, country: string, lat: number, lng: number): FakePlace =>
  ({ id, name, region, countryCode, country, lat, lng, label: `${name}, ${region && region !== name ? region + ', ' : ''}${country}` });
export const FAKE_PLACES: FakePlace[] = [
  p(2267057, 'Lisbon', 'Lisbon', 'PT', 'Portugal', 38.72, -9.14), p(2735943, 'Porto', 'Porto', 'PT', 'Portugal', 41.15, -8.61), p(3117735, 'Madrid', 'Madrid', 'ES', 'Spain', 40.42, -3.7),
  p(3128760, 'Barcelona', 'Catalonia', 'ES', 'Spain', 41.39, 2.17), p(2988507, 'Paris', 'Ile-de-France', 'FR', 'France', 48.86, 2.35), p(2643743, 'London', 'England', 'GB', 'United Kingdom', 51.51, -0.13),
  p(2964574, 'Dublin', 'Leinster', 'IE', 'Ireland', 53.35, -6.26), p(2759794, 'Amsterdam', 'North Holland', 'NL', 'Netherlands', 52.37, 4.9), p(2950159, 'Berlin', 'Berlin', 'DE', 'Germany', 52.52, 13.41),
  p(3169070, 'Rome', 'Latium', 'IT', 'Italy', 41.9, 12.5), p(2761369, 'Vienna', 'Vienna', 'AT', 'Austria', 48.21, 16.37), p(2673730, 'Stockholm', 'Stockholm', 'SE', 'Sweden', 59.33, 18.07),
  p(756135, 'Warsaw', 'Mazovia', 'PL', 'Poland', 52.23, 21.01), p(264371, 'Athens', 'Attica', 'GR', 'Greece', 37.98, 23.73), p(745044, 'Istanbul', 'Istanbul', 'TR', 'Turkey', 41.01, 28.98),
  p(1273874, 'Kochi', 'Kerala', 'IN', 'India', 9.93, 76.27), p(1277333, 'Bengaluru', 'Karnataka', 'IN', 'India', 12.97, 77.59), p(1275339, 'Mumbai', 'Maharashtra', 'IN', 'India', 19.08, 72.88),
  p(1273294, 'Delhi', 'Delhi', 'IN', 'India', 28.61, 77.21), p(1264527, 'Chennai', 'Tamil Nadu', 'IN', 'India', 13.08, 80.27), p(1254163, 'Thiruvananthapuram', 'Kerala', 'IN', 'India', 8.52, 76.94),
  p(1880252, 'Singapore', '', 'SG', 'Singapore', 1.35, 103.82), p(1850147, 'Tokyo', 'Tokyo', 'JP', 'Japan', 35.68, 139.65), p(2147714, 'Sydney', 'New South Wales', 'AU', 'Australia', -33.87, 151.21),
  p(5128581, 'New York City', 'New York', 'US', 'United States', 40.71, -74.01), p(5368361, 'Los Angeles', 'California', 'US', 'United States', 34.05, -118.24), p(6167865, 'Toronto', 'Ontario', 'CA', 'Canada', 43.65, -79.38),
  p(3530597, 'Mexico City', 'Mexico City', 'MX', 'Mexico', 19.43, -99.13), p(3448439, 'Sao Paulo', 'Sao Paulo', 'BR', 'Brazil', -23.55, -46.63), p(2332459, 'Lagos', 'Lagos', 'NG', 'Nigeria', 6.52, 3.38),
  p(184745, 'Nairobi', 'Nairobi', 'KE', 'Kenya', -1.29, 36.82), p(3369157, 'Cape Town', 'Western Cape', 'ZA', 'South Africa', -33.92, 18.42),
];
export const fakePlaceById = (id: number | null) => FAKE_PLACES.find((x) => x.id === id) ?? null;
const hit = ({ lat: _a, lng: _b, ...rest }: FakePlace): PlaceHit => { void _a; void _b; return rest; };
export function fakeSearchPlaces(query: string, limit = 8): PlaceHit[] {
  const q = query.replace(/[%_]/g, '').trim().toLowerCase();
  if (q.length < 2) return [];
  return FAKE_PLACES.filter((x) => x.name.toLowerCase().startsWith(q)).slice(0, Math.min(limit, 10)).map(hit);
}
export function fakeNearestPlaces(lat: number, lng: number, limit = 3): PlaceHit[] {
  return [...FAKE_PLACES].sort((a, b) => haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b)).slice(0, Math.min(limit, 5)).map(hit);
}
