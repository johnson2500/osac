// The grids monitoring API is plain REST served by the OSAC UI proxy: fetch is
// stubbed, not a Connect mock transport (see test-utils/gridsFetch.ts).
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@osac/ui-components/test-utils/TestProviders';

import GridsOverview from './GridsOverview';
import type { GridAccess } from './types';
import { jsonResponse, stubFetch } from '../test-utils/gridsFetch';

const grids = (statuses: Record<string, GridAccess['status']>): GridAccess[] =>
  Object.entries(statuses).map(([id, status]) => ({ id, status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GridsOverview', () => {
  it('merges the stat queries of every connected grid, with a totals row', async () => {
    stubFetch((url) => {
      const path = url.pathname;
      if (path.endsWith('/datasources') && !path.includes('/proxy/')) {
        return jsonResponse(200, [
          { metadata: { name: 'loki' }, spec: { kind: 'LokiDatasource' } },
        ]);
      }
      // One instant query per stat per grid: grid-a reports 100, grid-b 23.
      const value = path.startsWith('/api/grids/grid-a/') ? '100' : '23';
      return jsonResponse(200, { data: { result: [{ value: [0, value] }] } });
    });

    renderWithProviders(
      <GridsOverview grids={grids({ 'grid-a': 'connected', 'grid-b': 'connected' })} />,
      {
        routerEntries: ['/grids'],
      },
    );

    expect(await screen.findByText('grid-a')).toBeInTheDocument();
    expect(screen.getByText('grid-b')).toBeInTheDocument();
    // Requests (the additive stat) sums across grids: 100 + 23.
    expect(screen.getByText('123')).toBeInTheDocument();
    // The rate stats do not total across grids.
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('shows em dashes for a grid whose queries could not run', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/datasources') && !url.pathname.includes('/proxy/')) {
        return jsonResponse(403, {});
      }
      return jsonResponse(200, {});
    });

    renderWithProviders(<GridsOverview grids={grids({ 'grid-a': 'connected' })} />, {
      routerEntries: ['/grids'],
    });

    expect(await screen.findByText('grid-a')).toBeInTheDocument();
    // The degradation is surfaced, not just an em dash: the row reports the
    // status its queries settled on.
    expect(screen.getByText('No access')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('renders nothing when no grid is connected', () => {
    stubFetch(() => jsonResponse(200, {}));

    const { container } = renderWithProviders(
      <GridsOverview grids={grids({ 'grid-a': 'sign-in-required' })} />,
      { routerEntries: ['/grids'] },
    );

    expect(container).toBeEmptyDOMElement();
  });
});
