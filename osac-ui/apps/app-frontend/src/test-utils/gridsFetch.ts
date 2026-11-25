// Test helpers for the grids API surface. The grids API is plain REST served
// by the OSAC UI proxy (/api/grids), not the Connect layer, so there is no
// mock transport to stub: mocking global fetch is the accepted approach here
// (AGENTS.md's "don't mock fetch" rule targets Connect clients). Every grids
// test that stubs fetch must carry this rationale, so it lives here once.
import { vi } from 'vitest';

/** A JSON Response with the grids proxy's conventions. */
export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** Stubs global fetch with a URL router; unstubbed in afterEach by the caller. */
export const stubFetch = (handler: (url: URL) => Response | Promise<Response>) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string | URL) =>
        Promise.resolve(handler(new URL(url.toString(), 'https://ui.example.com'))),
      ),
  );
};
