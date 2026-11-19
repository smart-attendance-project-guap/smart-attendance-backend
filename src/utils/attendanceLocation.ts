type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function getDistanceMeters(from: Coordinates, to: Coordinates): number {
  const fromLatitude = from.latitude * DEGREES_TO_RADIANS;
  const toLatitude = to.latitude * DEGREES_TO_RADIANS;
  const latitudeDifference = toLatitude - fromLatitude;
  const longitudeDifference =
    (to.longitude - from.longitude) * DEGREES_TO_RADIANS;

  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function parseLocationInput(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { latitude, longitude, accuracyMeters, capturedAt } = value as {
    latitude?: unknown;
    longitude?: unknown;
    accuracyMeters?: unknown;
    capturedAt?: unknown;
  };

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof accuracyMeters !== "number" ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0 ||
    typeof capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)
  ) {
    return null;
  }

  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    return null;
  }

  return { latitude, longitude, accuracyMeters, capturedAtMs };
}