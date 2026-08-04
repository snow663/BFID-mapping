const PATCH_FLAG = '__bfidLayerMenuBehaviorInstalled';
const STYLE_ID = 'bfid-layer-menu-behavior-styles';
const REFERENCE_OPTION_ID = 'bfid-canal-ditch-reference-option';
const REFERENCE_INPUT_ID = 'bfid-canal-ditch-reference-toggle';
const CONTROL_RETRY_DELAY_MS = 100;
const CONTROL_RETRY_LIMIT = 150;

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

function renameWaterOverlay(panel: HTMLElement): HTMLElement | null {
  for (const option of panel.querySelectorAll<HTMLElement>('.bfid-layer-option')) {
    const title = option.querySelector<HTMLElement>('b');
    if (!title) continue;
    if (!/water lines|hydrography|water overlay/i.test(title.textContent ?? '')) continue;

    if (title.textContent !== 'Water overlay') title.textContent = 'Water overlay';
    const detail = option.querySelector<HTMLElement>('small');
    const detailText = 'USGS streams, waterbodies and available water-feature names';
    if (detail && detail.textContent !== detailText) detail.textContent = detailText;
    return option;
  }
  return null;
}

function createReferenceOption(layerPanel: HTMLElement, reconToggle: HTMLInputElement): void {
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
  detail.textContent = 'Selectable blue USGS reference lines; tap a line to make Add line available';
  text.append(title, detail);
  option.append(input, text);

  input.addEventListener('change', () => {
    if (reconToggle.checked !== input.checked) {
      reconToggle.checked = input.checked;
      reconToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  reconToggle.addEventListener('change', () => {
    if (input.checked !== reconToggle.checked) input.checked = reconToggle.checked;
  });

  const waterOption = renameWaterOverlay(layerPanel);
  if (waterOption) waterOption.after(option);
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

  const buttonTitle = 'Add the selected public canal or ditch reference to the BFID project';
  button.textContent = 'Add line';
  button.title = buttonTitle;
  button.setAttribute('aria-label', buttonTitle);

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
    const shouldHide = noSelection || !reconToggle.checked;
    if (button.hidden !== shouldHide) button.hidden = shouldHide;
    if (shouldHide && !panel.hidden) {
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

function synchronizeControls(): boolean {
  const layerPanel = document.querySelector<HTMLElement>('.bfid-layer-menu');
  const reconControl = document.querySelector<HTMLElement>('.bfid-recon-control');
  const reconToggle = reconControl?.querySelector<HTMLInputElement>('.bfid-recon-toggle input[type="checkbox"]');

  if (!layerPanel || !reconControl || !reconToggle) return false;

  renameWaterOverlay(layerPanel);
  createReferenceOption(layerPanel, reconToggle);
  simplifyReferenceAction(reconControl, reconToggle);
  return true;
}

function waitForControls(attempt = 0): void {
  if (synchronizeControls() || attempt >= CONTROL_RETRY_LIMIT) return;
  window.setTimeout(() => waitForControls(attempt + 1), CONTROL_RETRY_DELAY_MS);
}

export function installLayerMenuBehavior(): void {
  const globalState = window as unknown as GlobalState;
  if (globalState[PATCH_FLAG]) return;
  globalState[PATCH_FLAG] = true;

  ensureStyles();
  waitForControls();
}
