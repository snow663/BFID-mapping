import './nativeGeolocation';
import { Map as MapLibreMap, type IControl } from 'maplibre-gl';

const PATCH_FLAG = '__bfidGpsFollowPatchInstalled';
const MAP_FLAG = '__bfidGpsFollowInitialized';
const STATE_KEY = '__bfidGpsFollowState';
const STYLE_ID = 'bfid-gps-follow-styles';

type CameraSnapshot = {
  center: unknown;
  zoom?: number;
  bearing?: number;
  pitch?: number;
};

type FollowState = {
  follow: boolean;
  lastCamera: CameraSnapshot | null;
  control: FollowLocationControl | null;
  gpsAvailable: boolean;
};

function getState(map: MapLibreMap): FollowState {
  const mapWithState = map as any;
  if (!Object.prototype.hasOwnProperty.call(mapWithState, STATE_KEY)) {
    mapWithState[STATE_KEY] = {
      follow: true,
      lastCamera: null,
      control: null,
      gpsAvailable: false
    } satisfies FollowState;
  }
  return mapWithState[STATE_KEY] as FollowState;
}

function hasLiveGpsMarker(map: MapLibreMap): boolean {
  return Boolean(map.getContainer().querySelector('.position-marker.live'));
}

function looksLikeLiveGpsCamera(map: MapLibreMap, options: any): boolean {
  if (!options || options.center === undefined) return false;
  const zoom = Number(options.zoom ?? map.getZoom());
  return Number.isFinite(zoom) && zoom >= 14.9 && hasLiveGpsMarker(map);
}

function snapshotCamera(options: any): CameraSnapshot {
  return {
    center: options.center,
    zoom: typeof options.zoom === 'number' ? options.zoom : undefined,
    bearing: typeof options.bearing === 'number' ? options.bearing : undefined,
    pitch: typeof options.pitch === 'number' ? options.pitch : undefined
  };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-location-follow-control[hidden] { display: none !important; }
    .bfid-location-follow-button {
      width: 40px !important;
      height: 40px !important;
      display: grid !important;
      place-items: center;
      padding: 0 !important;
      color: #36443d;
      background: #ffffff !important;
    }
    .bfid-location-follow-button svg {
      width: 23px;
      height: 23px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .bfid-location-follow-button.following {
      color: #1769e0;
      box-shadow: inset 0 0 0 2px rgba(23, 105, 224, 0.2);
    }
    .bfid-location-follow-button:not(.following) {
      color: #4d5c54;
    }
  `;
  document.head.append(style);
}

class FollowLocationControl implements IControl {
  private map: MapLibreMap | null = null;
  private state: FollowState | null = null;
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    this.state = getState(map);
    this.state.control = this;
    ensureStyles();

    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group bfid-location-follow-control';
    container.hidden = true;
    this.container = container;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bfid-location-follow-button';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>
        <circle cx="12" cy="12" r="5"></circle>
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"></circle>
      </svg>
    `;
    button.addEventListener('click', () => {
      if (!this.map || !this.state?.lastCamera || !hasLiveGpsMarker(this.map)) return;
      this.state.follow = true;
      this.update();
      this.map.easeTo({ ...this.state.lastCamera, duration: 350 } as any);
    });
    this.button = button;
    container.append(button);
    this.update();
    return container;
  }

  update(): void {
    if (!this.container || !this.button || !this.state) return;
    this.container.hidden = !this.state.gpsAvailable;
    this.button.classList.toggle('following', this.state.follow);
    this.button.title = this.state.follow
      ? 'Following current position. Drag the map to break away.'
      : 'Recenter and follow current position';
    this.button.setAttribute('aria-label', this.button.title);
    this.button.setAttribute('aria-pressed', String(this.state.follow));
  }

  onRemove(): void {
    if (this.state?.control === this) this.state.control = null;
    this.container?.remove();
    this.container = null;
    this.button = null;
    this.state = null;
    this.map = null;
  }
}

function syncGpsAvailability(map: MapLibreMap): void {
  const state = getState(map);
  const available = hasLiveGpsMarker(map);
  if (available === state.gpsAvailable) return;

  state.gpsAvailable = available;
  if (!available) {
    state.follow = true;
    state.lastCamera = null;
  }
  state.control?.update();
}

export function installGpsFollowPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalJumpTo = prototype.jumpTo as (...args: any[]) => MapLibreMap;
  prototype.jumpTo = function patchedJumpTo(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const options = args[0];
    if (looksLikeLiveGpsCamera(this, options)) {
      const state = getState(this);
      state.gpsAvailable = true;
      state.lastCamera = snapshotCamera(options);
      state.control?.update();
      if (!state.follow) return this;
    }
    return originalJumpTo.apply(this, args);
  };

  const originalEaseTo = prototype.easeTo as (...args: any[]) => MapLibreMap;
  prototype.easeTo = function patchedEaseTo(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const options = args[0];
    if (looksLikeLiveGpsCamera(this, options)) {
      const state = getState(this);
      state.gpsAvailable = true;
      state.lastCamera = snapshotCamera(options);
      state.control?.update();
      if (!state.follow) return this;
    }
    return originalEaseTo.apply(this, args);
  };

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    const firstControl = !Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG);
    if (firstControl) {
      mapWithFlag[MAP_FLAG] = true;
      const state = getState(this);

      this.on('dragstart', () => {
        if (!hasLiveGpsMarker(this)) return;
        state.follow = false;
        state.gpsAvailable = true;
        state.control?.update();
      });
      this.on('render', () => syncGpsAvailability(this));
    }

    const result = originalAddControl.apply(this, args);
    if (firstControl) {
      const state = getState(this);
      const control = new FollowLocationControl();
      state.control = control;
      originalAddControl.call(this, control, 'top-right');
    }
    return result;
  };
}
