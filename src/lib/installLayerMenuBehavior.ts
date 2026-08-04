const PATCH_FLAG = '__bfidLayerMenuBehaviorInstalled';
const STYLE_ID = 'bfid-layer-menu-behavior-styles';
const REFERENCE_OPTION_ID = 'bfid-canal-ditch-reference-option';
const REFERENCE_INPUT_ID = 'bfid-canal-ditch-reference-toggle';
const KEEP_OPEN_MILLISECONDS = 1200;

type GlobalState = Window & Record<string, unknown>;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-recon-button[hidden],
    .bfid-recon-toggle[hidden],
    .bfid-recon-panel > [hidden] {
      display: none !important;
    }
  `;
  document.head.append(style);
}

function keepPanelOpen(panel: HTMLElement, button: HTMLButtonElement, until: number): void {
  if (performance.now() > until || !panel.hidden) return;
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
}

function installPanelInteractionGuard(panel: HTMLElement, button: HTMLButtonElement): void {
  if (panel.dataset.bfidInteractionGuard === 'true') return;
  panel.dataset.bfidInteractionGuard = 'true';

  let keepOpenUntil = 0;
  const markInternalInteraction = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.bfid-explicit-panel-close')) {
      keepOpenUntil = 0;
      return;
    }
    keepOpenUntil = performance.now() + KEEP_OPEN_MILLISECONDS;
  };

  panel.addEventListener('pointerdown', markInternalInteraction, true);
  panel.addEventListener('touchstart', markInternalInteraction, true);
  panel.addEventListener('mousedown', markInternalInteraction, true);

  for (const eventName of ['click', 'dblclick', 'pointerup', 'touchend', 'change']) {
    panel.addEventListener(eventName, (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.bfid-explicit-panel-close')) event.stopPropagation();
    });
  }

  const observer = new MutationObserver(() => {
    if (panel.hidden && performance.now() <= keepOpenUntil) {
      queueMicrotask(() => keepPanelOpen(panel, button, keepOpenUntil));
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

function renameWaterOverlay(panel: HTMLElement): HTMLElement | null {
  for (const option of panel.querySelectorAll<HTMLElement>('.bfid-layer-option')) {
    const title = option.querySelector<HTMLElement>('b');
    if (!title) continue;
    if (!/water lines|hydrography|water overlay/i.test(title.textContent ?? '')) continue;

    title.textContent = 'Water overlay';
    const detail = option.querySelector<HTMLElement>('small');
    if (detail) detail.textContent = 'USGS streams, waterbodies and available water-feature names';
    return option;
  }
  return null;
}

function createReferenceOption(
  layerPanel: HTMLElement,
  reconToggle: HTMLInputElement,
  layerButton: HTMLButtonElement
): void {
  if (document.getElementById(REFERENCE_OPTION_ID)) return;

  const option = document.createElement('label');
  option.id = REFERENCE_OPTION_ID;
  option.className = 'bfid-layer-option';

  const input = document.createElement('input');
  input.id = REFERENCE_INPUT_ID;
  input.type = 'checkbox';
  input.checked = reconToggle.checked;

  const text = document.createElement('span');
  const title = document.createElement('b');
  title.textContent = 'Canal/ditch reference';
  const detail = document.createElement('small');
  detail.textContent = 'Selectable blue USGS reference lines; tap one to make the Add line action available';
  text.append(title, detail);
  option.append(input, text);

  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', (event) => {
    event.stopPropagation();
    reconToggle.checked = input.checked;
    reconToggle.dispatchEvent(new Event('change', { bubbles: true }));

    // Some Android WebViews route a checkbox tap through the underlying map
    // control after the panel is moved to document.body. Reassert the intended
    // open state after the checkbox and MapLibre style updates complete.
    queueMicrotask(() => {
      layerPanel.hidden = false;
      layerButton.setAttribute('aria-expanded', 'true');
    });
  });

  reconToggle.addEventListener('change', () => {
    input.checked = reconToggle.checked;
  });

  const waterOption = renameWaterOverlay(layerPanel);
  if (waterOption?.nextSibling) layerPanel.insertBefore(option, waterOption.nextSibling);
  else if (waterOption) waterOption.after(option);
  else {
    const actions = layerPanel.querySelector('.bfid-layer-actions');
    if (actions) layerPanel.insertBefore(option, actions);
    else layerPanel.append(option);
  }
}

function simplifyReferenceAction(reconControl: HTMLElement, reconToggle: HTMLInputElement): void {
  const button = reconControl.querySelector<HTMLButtonElement>('.bfid-recon-button');
  const panel = reconControl.querySelector<HTMLElement>('.bfid-recon-panel');
  const selectedBox = panel?.querySelector<HTMLElement>('.bfid-recon-selected');
  if (!button || !panel || !selectedBox) return;

  button.textContent = 'Add line';
  button.title = 'Add the selected public canal or ditch reference to the BFID project';
  button.setAttribute('aria-label', button.title);

  const heading = panel.querySelector<HTMLElement>('h3');
  if (heading) heading.textContent = 'Add selected reference line';

  const source = panel.querySelector<HTMLElement>('.bfid-recon-source');
  if (source) {
    source.textContent =
      'The blue line is public USGS reference geometry. Adding it creates a local BFID project line that can be named, classified and field-verified.';
  }

  const toggleLabel = reconToggle.closest<HTMLElement>('.bfid-recon-toggle');
  if (toggleLabel) toggleLabel.hidden = true;

  for (const headingElement of panel.querySelectorAll<HTMLElement>('h4')) {
    const text = headingElement.textContent ?? '';
    if (/Belle Fourche Project scale|Local project database/i.test(text)) {
      headingElement.hidden = true;
      const following = headingElement.nextElementSibling;
      if (following instanceof HTMLElement) following.hidden = true;
    } else if (/Selected reference/i.test(text)) {
      headingElement.textContent = 'Selected public reference';
    }
  }

  const updateButtonVisibility = (): void => {
    const noSelection = /No line selected/i.test(selectedBox.textContent ?? '');
    button.hidden = noSelection || !reconToggle.checked;
    if (button.hidden && !panel.hidden) {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  };

  updateButtonVisibility();
  if (selectedBox.dataset.bfidSelectionObserver !== 'true') {
    selectedBox.dataset.bfidSelectionObserver = 'true';
    const observer = new MutationObserver(updateButtonVisibility);
    observer.observe(selectedBox, { childList: true, subtree: true, characterData: true });
    reconToggle.addEventListener('change', updateButtonVisibility);
  }
}

function synchronizeControls(): void {
  const layerControl = document.querySelector<HTMLElement>('.bfid-layer-control');
  const layerPanel = layerControl?.querySelector<HTMLElement>('.bfid-layer-menu');
  const layerButton = layerControl?.querySelector<HTMLButtonElement>('.bfid-layer-button');
  const reconControl = document.querySelector<HTMLElement>('.bfid-recon-control');
  const reconToggle = reconControl?.querySelector<HTMLInputElement>('.bfid-recon-toggle input[type="checkbox"]');

  if (!layerControl || !layerPanel || !layerButton || !reconControl || !reconToggle) return;

  installPanelInteractionGuard(layerPanel, layerButton);
  renameWaterOverlay(layerPanel);
  createReferenceOption(layerPanel, reconToggle, layerButton);
  simplifyReferenceAction(reconControl, reconToggle);
}

export function installLayerMenuBehavior(): void {
  const globalState = window as unknown as GlobalState;
  if (globalState[PATCH_FLAG]) return;
  globalState[PATCH_FLAG] = true;

  ensureStyles();

  // Retire the older standalone recon visibility preference. Visibility is
  // now controlled by the single Layers menu.
  try {
    window.localStorage.setItem('bfid-usgs-irrigation-reference-visible', 'true');
  } catch {
    // Current-session controls still work if localStorage is unavailable.
  }

  synchronizeControls();
  const observer = new MutationObserver(synchronizeControls);
  observer.observe(document.documentElement, { subtree: true, childList: true });
}
