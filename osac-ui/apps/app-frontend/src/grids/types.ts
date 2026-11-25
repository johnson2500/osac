/**
 * The AI Grid surfaces the OSAC UI proxy serves: GET /api/grids lists the
 * grids (IDs only), and per-grid calls under /api/grids/<id>/* are forwarded
 * to the grid hub's console BFF with the silently exchanged hub token.
 */

export interface GridSummary {
  id: string;
}

export interface GridsResponse {
  grids: GridSummary[];
}

/**
 * What the OSAC UI knows about one grid's access, from probing the grid hub's
 * own user endpoint through the proxy:
 *
 * - connected: the proxy holds a valid hub token for this user
 * - sign-in-required: 401 with X-Grid-Login-URL — the browser must go through
 *   the silent login once before grid calls work
 * - session-expired: 401 without X-Grid-Login-URL — the OSAC session itself
 *   is gone; the app needs its regular OSAC login again
 * - no-access: the hub recognizes the user but refuses them (403); reported,
 *   not hidden
 * - unreachable: anything else (network error, 5xx)
 */
export type GridAccessStatus =
  | 'connected'
  | 'sign-in-required'
  | 'session-expired'
  | 'no-access'
  | 'unreachable';

export interface GridAccess {
  id: string;
  status: GridAccessStatus;
  /** Set for sign-in-required: the X-Grid-Login-URL the proxy sent. */
  loginUrl?: string;
  /** Set for connected: the username the grid hub reported. */
  username?: string;
}
