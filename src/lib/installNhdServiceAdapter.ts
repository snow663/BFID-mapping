const NHD_FLOWLINE_QUERY = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query';

let installed = false;

/**
 * The current USGS NHD large-scale flowline service exposes lowercase field
 * names even though its display aliases are uppercase. Normalize requests to
 * that one endpoint so the reconnaissance layer stays compatible with the
 * live service contract without affecting any other application request.
 */
export function installNhdServiceAdapter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (!requestUrl.startsWith(NHD_FLOWLINE_QUERY)) return originalFetch(input, init);

    const url = new URL(requestUrl);
    url.searchParams.set('where', 'ftype = 336');
    url.searchParams.set(
      'outFields',
      'permanent_identifier,gnis_name,reachcode,ftype,fcode,lengthkm'
    );

    if (input instanceof Request) return originalFetch(new Request(url, input), init);
    return originalFetch(url, init);
  }) as typeof window.fetch;
}
