import type { GridAccess, GridAccessStatus, GridsResponse } from './types';

const GRID_LOGIN_HEADER = 'X-Grid-Login-URL';

export class GridApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Maps a grid-route response to the access status it implies, or undefined
 * when the response is not an auth decision (2xx, or a network/5xx failure).
 * Shared by the access probe and the cross-grid overview queries.
 */
export const responseStatus = (response: Response): GridAccessStatus | undefined => {
  if (response.status === 401) {
    // A bare 401 means the OSAC session itself is gone, not just the grid
    // token — the app's regular OSAC login is needed.
    return response.headers.get(GRID_LOGIN_HEADER) ? 'sign-in-required' : 'session-expired';
  }
  if (response.status === 403) {
    return 'no-access';
  }
  return undefined;
};

const fetchOk = async (url: string): Promise<Response> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    throw new GridApiError(`Request to ${url} failed: ${response.status}`, response.status);
  }
  return response;
};

/** Lists the grids the OSAC UI proxy is configured for (IDs only). */
export const fetchGrids = async (): Promise<GridsResponse> => {
  const response = await fetchOk('/api/grids');
  if (response.status === 401) {
    throw new GridApiError('Not signed in to OSAC', 401);
  }
  return (await response.json()) as GridsResponse;
};

/**
 * Probes one grid's access through the proxy by asking the grid hub's own
 * user endpoint. The SPA contract (OSAC-8173): a 401 carries X-Grid-Login-URL
 * for the silent login; a 403 means the hub refuses this user — reported,
 * not hidden.
 */
export const probeGrid = async (id: string): Promise<GridAccess> => {
  const response = await fetchOk(`/api/grids/${id}/api/v1/user`);
  const authStatus = responseStatus(response);
  if (authStatus === 'sign-in-required') {
    return {
      id,
      status: 'sign-in-required',
      loginUrl: response.headers.get(GRID_LOGIN_HEADER) ?? undefined,
    };
  }
  if (authStatus) {
    return { id, status: authStatus };
  }
  const body = (await response.json()) as { username?: string };
  return { id, status: 'connected', username: body.username };
};
