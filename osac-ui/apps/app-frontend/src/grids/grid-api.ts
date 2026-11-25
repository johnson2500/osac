import type { GridAccess, GridsResponse } from './types';

const GRID_LOGIN_HEADER = 'X-Grid-Login-URL';

class GridApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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
  if (response.status === 401) {
    return {
      id,
      status: 'sign-in-required',
      loginUrl: response.headers.get(GRID_LOGIN_HEADER) ?? undefined,
    };
  }
  if (response.status === 403) {
    return { id, status: 'no-access' };
  }
  const body = (await response.json()) as { username?: string };
  return { id, status: 'connected', username: body.username };
};
