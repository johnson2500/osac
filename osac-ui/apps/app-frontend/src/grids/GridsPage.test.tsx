// The grids API is plain REST served by the OSAC UI proxy (/api/grids): fetch
// is stubbed, not a Connect mock transport (see test-utils/gridsFetch.ts).
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@osac/ui-components/test-utils/TestProviders';

import GridsPage from './GridsPage';
import { jsonResponse } from '../test-utils/gridsFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubGridFetch = (...responses: Response[]) => {
  // /api/grids first, then one probe per grid in list order.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string | URL) => {
      const target = typeof url === 'string' ? url : url.href;
      if (target === '/api/grids') {
        return jsonResponse(200, {
          grids: responses.map((_r, i) => ({ id: `grid-${i}` })),
        });
      }
      // Cross-grid overview reads (connected grids only): the datasource
      // listing and the stat queries through the Perses relay.
      if (target.includes('/perses/')) {
        if (target.endsWith('/datasources')) {
          return jsonResponse(200, [
            { metadata: { name: 'loki' }, spec: { kind: 'LokiDatasource' } },
          ]);
        }
        return jsonResponse(200, { data: { result: [{ value: [0, '42'] }] } });
      }
      const id = target.split('/')[3];
      const index = Number(id.split('-')[1]);
      return responses[index];
    }),
  );
};

describe('GridsPage', () => {
  it('lists grids with their access status and actions', async () => {
    stubGridFetch(
      jsonResponse(200, { username: 'provider-admin' }),
      jsonResponse(401, {}, { 'X-Grid-Login-URL': '/api/grids/grid-1/login' }),
      jsonResponse(403, {}),
    );

    renderWithProviders(<GridsPage />, { routerEntries: ['/grids'] });

    expect(await screen.findByRole('heading', { name: 'AI Grids' })).toBeInTheDocument();
    // The overview merges the connected grid's stats (async fan-out): 42 in
    // the grid's row and in the additive stat's Total row.
    expect(await screen.findAllByText('42')).toHaveLength(2);
    expect(screen.getAllByText('grid-0')).toHaveLength(2); // table + overview
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('provider-admin')).toBeInTheDocument();

    expect(screen.getByText('grid-1')).toBeInTheDocument();
    expect(screen.getByText('Sign-in required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/api/grids/grid-1/login?redirect=%2Fgrids',
    );

    expect(screen.getByText('grid-2')).toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open console' }).getAttribute('href')).toBe(
      '/api/grids/grid-0/',
    );
  });

  it('shows the empty state when no grids are configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { grids: [] })));

    renderWithProviders(<GridsPage />, { routerEntries: ['/grids'] });

    expect(await screen.findByText('No AI Grids are configured.')).toBeInTheDocument();
  });

  it('shows the error state when the grid list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));

    renderWithProviders(<GridsPage />, { routerEntries: ['/grids'] });

    expect(await screen.findByText('Not signed in to OSAC')).toBeInTheDocument();
  });
});
