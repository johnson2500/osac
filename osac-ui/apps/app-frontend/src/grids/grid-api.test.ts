import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGrids, probeGrid } from './grid-api';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGrids', () => {
  it('returns the grid list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { grids: [{ id: 'sno-01' }] })),
    );

    const result = await fetchGrids();

    expect(result.grids).toEqual([{ id: 'sno-01' }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/grids', {
      headers: { Accept: 'application/json' },
    });
  });

  it('throws when the OSAC session is gone (401)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));

    await expect(fetchGrids()).rejects.toThrow('Not signed in to OSAC');
  });
});

describe('probeGrid', () => {
  it('reports connected with the grid username on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { username: 'provider-admin' })),
    );

    await expect(probeGrid('sno-01')).resolves.toEqual({
      id: 'sno-01',
      status: 'connected',
      username: 'provider-admin',
    });
  });

  it('reports sign-in-required with the X-Grid-Login-URL header on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, {}, { 'X-Grid-Login-URL': '/api/grids/sno-01/login' }),
        ),
    );

    await expect(probeGrid('sno-01')).resolves.toEqual({
      id: 'sno-01',
      status: 'sign-in-required',
      loginUrl: '/api/grids/sno-01/login',
    });
  });

  it('reports no-access on 403 — refused, not hidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));

    await expect(probeGrid('sno-01')).resolves.toEqual({ id: 'sno-01', status: 'no-access' });
  });

  it('throws on an unexpected status so the caller can mark the grid unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502, {})));

    await expect(probeGrid('sno-01')).rejects.toThrow('failed: 502');
  });
});
