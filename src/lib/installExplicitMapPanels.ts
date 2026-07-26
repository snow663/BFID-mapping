const PATCH_FLAG = '__bfidExplicitMapPanelsInstalled';
const STYLE_ID = 'bfid-explicit-map-panel-styles';
const BACKDROP_ID = 'bfid-map-panel-backdrop';

const PANEL_SPECS = [
  {
    controlClass: 'bfid-recon-control',
    buttonClass: 'bfid-recon-button',
    panelClass: 'bfid-recon-panel',
    title: 'Irrigation reconnaissance'
  },
  {
    controlClass: 'bfid-layer-control',
    buttonClass: 'bfid-layer-button',
    panelClass: 'bfid-layer-menu',
    title: 'Visible map elements'
  },
  {
    controlClass: 'bfid-import-control',
    buttonClass: 'bfid-import-button',
    panelClass: 'bfid-import-panel',
    title: 'Import project data'
  }
] as const;

type PanelSpec = (typeof PANEL_SPECS)[number];

type PanelHome = {
  control: HTMLElement;
  nextSibling: ChildNode | null;
};

const panelHomes = new WeakMap<HTMLElement, PanelHome>();
let syncQueued = false;

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1200px)').matches;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BACKDROP_ID} {
      position: fixed;
      z-index: 12900;
      inset: 0;
      border: 0;
      border-radius: 0;
      min-height: 0;
      padding: 0;
      background: rgba(0, 0, 0, .5);
      cursor: default;
    }
    #${BACKDROP_ID}[hidden] { display: none; }

    .bfid-explicit-panel-header {
      position: sticky;
      z-index: 20;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 52px;
      margin: -13px -13px 4px;
      padding: 8px 10px 8px 13px;
      border-bottom: 1px solid #456052;
      background: rgba(8, 24, 17, .995);
    }
    .bfid-explicit-panel-header strong {
      color: #edf4ef;
      font: 700 15px/1.2 system-ui, sans-serif;
    }
    .bfid-explicit-panel-close {
      width: auto !important;
      min-width: 72px !important;
      min-height: 38px !important;
      padding: 5px 12px !important;
      border: 1px solid #668675 !important;
      border-radius: 999px !important;
      background: #193126 !important;
      color: #fff !important;
      font: 700 12px/1 system-ui, sans-serif !important;
    }

    @media (max-width: 900px), (pointer: coarse) and (max-width: 1200px) {
      .bfid-explicit-map-panel {
        position: fixed !important;
        z-index: 13000 !important;
        top: calc(60px + env(safe-area-inset-top, 0px)) !important;
        right: 8px !important;
        bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
        left: 8px !important;
        width: auto !important;
        max-width: 620px !important;
        max-height: none !important;
        margin: 0 auto !important;
        padding: 13px !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        border-radius: 13px !important;
        box-shadow: 0 18px 55px rgba(0, 0, 0, .72) !important;
      }
    }
  `;
  document.head.append(style);
}

function getBackdrop(): HTMLButtonElement {
  const existing = document.getElementById(BACKDROP_ID);
  if (existing instanceof HTMLButtonElement) return existing;

  const backdrop = document.createElement('button');
  backdrop.id = BACKDROP_ID;
  backdrop.type = 'button';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-label', 'Close map menu');
  document.body.append(backdrop);
  return backdrop;
}

function specForButton(button: Element): PanelSpec | undefined {
  return PANEL_SPECS.find((spec) => button.classList.contains(spec.buttonClass));
}

function specForPanel(panel: Element): PanelSpec | undefined {
  return PANEL_SPECS.find((spec) => panel.classList.contains(spec.panelClass));
}

function findPanel(spec: PanelSpec, control?: HTMLElement | null): HTMLElement | null {
  return control?.querySelector<HTMLElement>(`.${spec.panelClass}`) ?? document.querySelector<HTMLElement>(`.${spec.panelClass}`);
}

function findControl(spec: PanelSpec, panel?: HTMLElement): HTMLElement | null {
  return panelHomes.get(panel ?? document.createElement('div'))?.control ?? document.querySelector<HTMLElement>(`.${spec.controlClass}`);
}

function ensurePanelHeader(panel: HTMLElement, spec: PanelSpec): void {
  if (panel.querySelector(':scope > .bfid-explicit-panel-header')) return;

  const header = document.createElement('div');
  header.className = 'bfid-explicit-panel-header';
  const title = document.createElement('strong');
  title.textContent = spec.title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bfid-explicit-panel-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', `Close ${spec.title}`);
  header.append(title, close);
  panel.prepend(header);
}

function restorePanel(panel: HTMLElement): void {
  const home = panelHomes.get(panel);
  if (!home) return;

  if (home.nextSibling && home.nextSibling.parentNode === home.control) {
    home.control.insertBefore(panel, home.nextSibling);
  } else {
    home.control.append(panel);
  }
  panel.classList.remove('bfid-explicit-map-panel');
  panelHomes.delete(panel);
}

function closePanel(panel: HTMLElement): void {
  const spec = specForPanel(panel);
  const home = panelHomes.get(panel);
  const control = home?.control ?? (spec ? document.querySelector<HTMLElement>(`.${spec.controlClass}`) : null);
  panel.hidden = true;
  restorePanel(panel);
  control?.querySelector<HTMLButtonElement>(spec ? `.${spec.buttonClass}` : 'button')?.setAttribute('aria-expanded', 'false');
}

function visiblePanels(): HTMLElement[] {
  return PANEL_SPECS
    .map((spec) => document.querySelector<HTMLElement>(`.${spec.panelClass}`))
    .filter((panel): panel is HTMLElement => Boolean(panel && !panel.hidden));
}

function syncBackdrop(): void {
  const open = visiblePanels().length > 0;
  getBackdrop().hidden = !open;
  document.body.classList.toggle('bfid-explicit-panel-open', open);
}

function closeAllPanels(except?: HTMLElement): void {
  for (const spec of PANEL_SPECS) {
    const panel = document.querySelector<HTMLElement>(`.${spec.panelClass}`);
    if (panel && panel !== except) closePanel(panel);
  }
  syncBackdrop();
}

function openPanel(control: HTMLElement, panel: HTMLElement, spec: PanelSpec): void {
  closeAllPanels(panel);
  ensurePanelHeader(panel, spec);

  if (!panelHomes.has(panel)) {
    panelHomes.set(panel, { control, nextSibling: panel.nextSibling });
  }

  if (isMobileViewport()) {
    panel.classList.add('bfid-explicit-map-panel');
    document.body.append(panel);
  }

  panel.hidden = false;
  control.querySelector<HTMLButtonElement>(`.${spec.buttonClass}`)?.setAttribute('aria-expanded', 'true');
  syncBackdrop();
  panel.scrollTop = 0;
  panel.querySelector<HTMLButtonElement>('.bfid-explicit-panel-close')?.focus({ preventScroll: true });
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    for (const spec of PANEL_SPECS) {
      const panel = document.querySelector<HTMLElement>(`.${spec.panelClass}`);
      if (!panel) continue;
      if (panel.hidden && panelHomes.has(panel)) restorePanel(panel);
    }
    syncBackdrop();
  });
}

export function installExplicitMapPanels(): void {
  const globalState = window as unknown as Record<string, unknown>;
  if (globalState[PATCH_FLAG]) return;
  globalState[PATCH_FLAG] = true;

  ensureStyles();
  getBackdrop();

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest(`#${BACKDROP_ID}`)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAllPanels();
        return;
      }

      const close = target.closest('.bfid-explicit-panel-close');
      if (close) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const panel = close.closest<HTMLElement>('.bfid-recon-panel,.bfid-layer-menu,.bfid-import-panel');
        if (panel) closePanel(panel);
        syncBackdrop();
        return;
      }

      const button = target.closest('.bfid-recon-button,.bfid-layer-button,.bfid-import-button');
      if (!button) return;

      const spec = specForButton(button);
      const control = spec ? button.closest<HTMLElement>(`.${spec.controlClass}`) : null;
      const panel = spec ? findPanel(spec, control) : null;
      if (!spec || !control || !panel) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (panel.hidden) openPanel(control, panel, spec);
      else {
        closePanel(panel);
        syncBackdrop();
      }
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && visiblePanels().length) {
      event.preventDefault();
      closeAllPanels();
    }
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden']
  });

  window.addEventListener('resize', () => {
    for (const panel of visiblePanels()) {
      const spec = specForPanel(panel);
      if (!spec) continue;
      const control = findControl(spec, panel);
      if (!control) continue;
      if (isMobileViewport() && panel.parentElement !== document.body) {
        if (!panelHomes.has(panel)) panelHomes.set(panel, { control, nextSibling: panel.nextSibling });
        panel.classList.add('bfid-explicit-map-panel');
        document.body.append(panel);
      } else if (!isMobileViewport()) {
        restorePanel(panel);
      }
    }
    syncBackdrop();
  });
}
