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

/**
 * One GET through the OSAC UI proxy's grid routes, mapped to the access
 * status an auth failure implies: the Response on success (2xx, body
 * unread), or the status string the caller should degrade to. Shared by the
 * datasource discovery and the stat queries.
 */
const fetchGridResource = async (url: string): Promise<Response | GridAccessStatus> => {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return 'unreachable';
  }
  const authStatus = responseStatus(response);
  if (authStatus) {
    return authStatus;
  }
  if (!response.ok) {
    return 'unreachable';
  }
  return response;
};

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
  const url = `/api/grids/${gridId}/perses/api/api/v1/projects/${MONITORING_PROJECT}/datasources`;
  const result = await fetchGridResource(url);
  if (typeof result === 'string') {
    return { status: result };
  }
  const datasources = (await result.json()) as PersesDatasource[];
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
  const result = await fetchGridResource(url);
  if (typeof result === 'string') {
    return { grid: gridId, status: result };
  }
  const body = (await result.json()) as {
    data?: { result?: { value?: [number, string] }[] };
  };
  const value = (body.data?.result ?? []).reduce(
    (sum, series) => sum + (Number(series.value?.[1]) || 0),
    0,
  );
  return { grid: gridId, status: 'connected', value };
};
