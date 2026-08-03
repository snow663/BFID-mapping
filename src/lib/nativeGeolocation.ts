type NativeGeolocationApi = typeof import('@tauri-apps/plugin-geolocation');

type PendingWatch = {
  cancelled: boolean;
  nativeId?: number;
};

const INSTALL_FLAG = '__bfidNativeGeolocationInstalled';
const watches = new Map<number, PendingWatch>();
let nextWatchId = 1;
let nativeApiPromise: Promise<NativeGeolocationApi> | null = null;
let permissionPromise: Promise<void> | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function loadNativeApi(): Promise<NativeGeolocationApi> {
  nativeApiPromise ??= import('@tauri-apps/plugin-geolocation');
  return nativeApiPromise;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Location service failed.';
  }
}

function browserError(error: unknown, code = 2): GeolocationPositionError {
  return {
    code,
    message: errorMessage(error),
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3
  } as GeolocationPositionError;
}

function browserPosition(position: Awaited<ReturnType<NativeGeolocationApi['getCurrentPosition']>>): GeolocationPosition {
  const raw = position.coords;
  const coords = {
    latitude: raw.latitude,
    longitude: raw.longitude,
    accuracy: raw.accuracy,
    altitude: raw.altitude,
    altitudeAccuracy: raw.altitudeAccuracy,
    heading: raw.heading,
    speed: raw.speed,
    toJSON() {
      return {
        latitude: raw.latitude,
        longitude: raw.longitude,
        accuracy: raw.accuracy,
        altitude: raw.altitude,
        altitudeAccuracy: raw.altitudeAccuracy,
        heading: raw.heading,
        speed: raw.speed
      };
    }
  } as GeolocationCoordinates;

  return {
    coords,
    timestamp: Number(position.timestamp) || Date.now(),
    toJSON() {
      return { coords: coords.toJSON(), timestamp: Number(position.timestamp) || Date.now() };
    }
  } as GeolocationPosition;
}

async function ensurePermission(api: NativeGeolocationApi): Promise<void> {
  permissionPromise ??= (async () => {
    let status = await api.checkPermissions();
    if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
      status = await api.requestPermissions(['location']);
    }
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      throw browserError('Location permission was not granted.', 1);
    }
  })().catch((error) => {
    permissionPromise = null;
    throw error;
  });
  return permissionPromise;
}

function optionsFromBrowser(options?: PositionOptions): {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
} {
  return {
    enableHighAccuracy: options?.enableHighAccuracy ?? true,
    timeout: Number.isFinite(options?.timeout) ? Number(options?.timeout) : 15000,
    maximumAge: Number.isFinite(options?.maximumAge) ? Number(options?.maximumAge) : 1000
  };
}

function nativeGeolocation(): Geolocation {
  return {
    getCurrentPosition(success, failure, options) {
      void (async () => {
        try {
          const api = await loadNativeApi();
          await ensurePermission(api);
          success(browserPosition(await api.getCurrentPosition(optionsFromBrowser(options))));
        } catch (error) {
          failure?.(error && typeof error === 'object' && 'code' in error
            ? error as GeolocationPositionError
            : browserError(error));
        }
      })();
    },

    watchPosition(success, failure, options) {
      const localId = nextWatchId++;
      const pending: PendingWatch = { cancelled: false };
      watches.set(localId, pending);

      void (async () => {
        try {
          const api = await loadNativeApi();
          await ensurePermission(api);
          if (pending.cancelled) return;

          const nativeId = await api.watchPosition(optionsFromBrowser(options), (position, error) => {
            if (pending.cancelled) return;
            if (error) {
              failure?.(browserError(error));
              return;
            }
            if (position) success(browserPosition(position));
          });
          pending.nativeId = nativeId;

          if (pending.cancelled) {
            await api.clearWatch(nativeId);
            watches.delete(localId);
          }
        } catch (error) {
          watches.delete(localId);
          failure?.(error && typeof error === 'object' && 'code' in error
            ? error as GeolocationPositionError
            : browserError(error));
        }
      })();

      return localId;
    },

    clearWatch(localId) {
      const pending = watches.get(localId);
      if (!pending) return;
      pending.cancelled = true;
      if (pending.nativeId === undefined) return;

      watches.delete(localId);
      void loadNativeApi()
        .then((api) => api.clearWatch(pending.nativeId!))
        .catch((error) => console.warn('Could not clear native GPS watch', error));
    }
  };
}

export function installNativeGeolocationBridge(): void {
  if (!isTauriRuntime()) return;
  const globalState = window as unknown as Record<string, unknown>;
  if (globalState[INSTALL_FLAG]) return;

  const replacement = nativeGeolocation();
  try {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      enumerable: true,
      value: replacement
    });
  } catch {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'geolocation', {
      configurable: true,
      enumerable: true,
      get: () => replacement
    });
  }

  globalState[INSTALL_FLAG] = true;
}

installNativeGeolocationBridge();
