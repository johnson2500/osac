import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@osac/ui-components/test-utils/TestProviders';

import GridsPage from './GridsPage';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

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
    expect(await screen.findByText('grid-0')).toBeInTheDocument();
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
