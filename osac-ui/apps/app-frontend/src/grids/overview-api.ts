// The grids monitoring API is plain REST served by the OSAC UI proxy (the
// grid hubs' Perses through the console BFF relay), not the Connect layer,
// so there is no mock transport to stub: mocking global fetch is the accepted
// approach here (AGENTS.md's "don't mock fetch" rule targets Connect
// clients).
import { responseStatus } from './grid-api';
import {
  type GridStatQuery,
  MONITORING_PROJECT,
  OVERVIEW_DATASOURCE_KIND,
} from './overview-queries';
import type { GridAccessStatus } from './types';

interface PersesDatasource {
  metadata: { name: string };
  spec: { kind: string };
}

export interface DatasourceResult {
  status: GridAccessStatus;
  /** The datasource name, set when status is connected. */
  name?: string;
}

/**
 * Finds the datasource the overview queries run against on one grid: the
 * project's datasource of the expected kind, through the OSAC UI proxy and
 * the console BFF's Perses relay (which allowlists exactly these reads).
 * Auth failures map to the same statuses the access probe reports.
 */
export const fetchOverviewDatasource = async (gridId: string): Promise<DatasourceResult> => {
  let response: Response;
  try {
    response = await fetch(
      `/api/grids/${gridId}/perses/api/api/v1/projects/${MONITORING_PROJECT}/datasources`,
      { headers: { Accept: 'application/json' } },
    );
  } catch {
    return { status: 'unreachable' };
  }
  const authStatus = responseStatus(response);
  if (authStatus) {
    return { status: authStatus };
  }
  if (!response.ok) {
    return { status: 'unreachable' };
  }
  const datasources = (await response.json()) as PersesDatasource[];
  const name = datasources.find((d) => d.spec.kind === OVERVIEW_DATASOURCE_KIND)?.metadata.name;
  return name ? { status: 'connected', name } : { status: 'unreachable' };
};

export interface GridQueryResult {
  grid: string;
  status: GridAccessStatus;
  /** Summed scalar of the query's result series (single-series queries). */
  value?: number;
}

/**
 * Runs one instant query on one grid's monitoring datasource through the
 * Perses datasource proxy. Auth failures map to the same statuses the access
 * probe reports, so a grid that cannot be queried degrades per grid instead
 * of failing the whole overview.
 */
export const queryGridStat = async (
  gridId: string,
  datasourceName: string,
  stat: GridStatQuery,
): Promise<GridQueryResult> => {
  const url =
    `/api/grids/${gridId}/perses/api/api/v1/proxy/projects/${MONITORING_PROJECT}` +
    `/datasources/${datasourceName}/api/v1/query?query=${encodeURIComponent(stat.query)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return { grid: gridId, status: 'unreachable' };
  }
  const authStatus = responseStatus(response);
  if (authStatus) {
    return { grid: gridId, status: authStatus };
  }
  if (!response.ok) {
    return { grid: gridId, status: 'unreachable' };
  }
  const body = (await response.json()) as {
    data?: { result?: { value?: [number, string] }[] };
  };
  const value = (body.data?.result ?? []).reduce(
    (sum, series) => sum + (Number(series.value?.[1]) || 0),
    0,
  );
  return { grid: gridId, status: 'connected', value };
};
