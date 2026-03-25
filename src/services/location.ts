import * as Location from "expo-location";
import ngeohash from "ngeohash";

const GEOHASH_PRECISION = 6;

let locationSubscription: Location.LocationSubscription | null = null;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export interface LocationData {
  latitude: number;
  longitude: number;
  geohash: string;
}

export async function getCurrentLocation(): Promise<LocationData | null> {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) return null;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const { latitude, longitude } = location.coords;
  const geohash = ngeohash.encode(latitude, longitude, GEOHASH_PRECISION);

  return { latitude, longitude, geohash };
}

export function startLocationUpdates(
  onUpdate: (loc: LocationData) => void,
  intervalMs: number = 30000
): () => void {
  let timer: ReturnType<typeof setInterval>;

  const update = async () => {
    const loc = await getCurrentLocation();
    if (loc) onUpdate(loc);
  };

  update();
  timer = setInterval(update, intervalMs);

  return () => {
    clearInterval(timer);
    if (locationSubscription) {
      locationSubscription.remove();
      locationSubscription = null;
    }
  };
}

export function getNeighborGeohashes(geohash: string): string[] {
  return [geohash, ...ngeohash.neighbors(geohash)];
}
