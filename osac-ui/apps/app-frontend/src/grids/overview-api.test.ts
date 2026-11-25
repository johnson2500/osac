// The grids monitoring API is plain REST served by the OSAC UI proxy, not
// the Connect layer, so there is no mock transport to stub: mocking global
// fetch is the accepted approach here (AGENTS.md's "don't mock fetch" rule
// targets Connect clients).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchOverviewDatasource, queryGridStat } from './overview-api';
import { GRID_STAT_QUERIES } from './overview-queries';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const datasourceList = (kind = 'LokiDatasource') => [
  { metadata: { name: 'other' }, spec: { kind: 'PrometheusDatasource' } },
  { metadata: { name: 'loki' }, spec: { kind } },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchOverviewDatasource', () => {
  it('returns the datasource of the overview kind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, datasourceList())));

    await expect(fetchOverviewDatasource('sno-01')).resolves.toEqual({
      status: 'connected',
      name: 'loki',
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/grids/sno-01/perses/api/api/v1/projects/ai-grid-monitoring/datasources',
      { headers: { Accept: 'application/json' } },
    );
  });

  it('reports sign-in-required on 401 with the login header', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, {}, { 'X-Grid-Login-URL': '/api/grids/sno-01/login' }),
        ),
    );

    await expect(fetchOverviewDatasource('sno-01')).resolves.toEqual({
      status: 'sign-in-required',
    });
  });

  it('reports unreachable when the kind is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, datasourceList('OtherDatasource'))),
    );

    await expect(fetchOverviewDatasource('sno-01')).resolves.toEqual({
      status: 'unreachable',
    });
  });
});

describe('queryGridStat', () => {
  it('runs the query through the datasource proxy and sums the series', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: { result: [{ value: [0, '120'] }, { value: [0, '30'] }] },
        }),
      ),
    );
    const stat = GRID_STAT_QUERIES[0];

    await expect(queryGridStat('sno-01', 'loki', stat)).resolves.toEqual({
      grid: 'sno-01',
      status: 'connected',
      value: 150,
    });

    const [calledUrl, init] = vi.mocked(fetch).mock.calls[0] as [string | URL, unknown];
    const url = typeof calledUrl === 'string' ? calledUrl : calledUrl.href;
    expect(url).toBe(
      '/api/grids/sno-01/perses/api/api/v1/proxy/projects/ai-grid-monitoring' +
        `/datasources/loki/api/v1/query?query=${encodeURIComponent(stat.query)}`,
    );
    expect(init).toEqual({ headers: { Accept: 'application/json' } });
  });

  it('reports no-access on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));

    await expect(queryGridStat('sno-01', 'loki', GRID_STAT_QUERIES[0])).resolves.toEqual({
      grid: 'sno-01',
      status: 'no-access',
    });
  });

  it('reports unreachable on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));

    await expect(queryGridStat('sno-01', 'loki', GRID_STAT_QUERIES[0])).resolves.toEqual({
      grid: 'sno-01',
      status: 'unreachable',
    });
  });
});
