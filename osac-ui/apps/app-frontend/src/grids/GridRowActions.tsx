import { Button } from '@patternfly/react-core';

import { useTranslation } from '@osac/ui-components/hooks/useTranslation';

import type { GridAccess } from './types';

interface GridRowActionsProps {
  grid: GridAccess;
}

/**
 * The action for one grid row. "Open console" navigates the browser through
 * the OSAC UI proxy, which sends it through the silent login first when no
 * hub token is cached (top-level navigations recover with a redirect);
 * "Sign in" goes straight to the login URL the proxy reported, returning to
 * the grids page afterwards.
 */
const GridRowActions = ({ grid }: GridRowActionsProps) => {
  const { t } = useTranslation();

  if (grid.status === 'connected') {
    return (
      <Button
        variant="secondary"
        component="a"
        href={`/api/grids/${grid.id}/`}
        target="_blank"
        rel="noopener"
      >
        {t('Open console')}
      </Button>
    );
  }

  if (grid.status === 'sign-in-required' && grid.loginUrl) {
    const loginUrl = new URL(grid.loginUrl, window.location.origin);
    loginUrl.searchParams.set('redirect', '/grids');
    return (
      <Button variant="secondary" component="a" href={loginUrl.pathname + loginUrl.search}>
        {t('Sign in')}
      </Button>
    );
  }

  if (grid.status === 'session-expired') {
    // The OSAC session is gone: reloading the app restarts its regular
    // OSAC login flow, which lands back on this page.
    return (
      <Button variant="secondary" onClick={() => window.location.reload()}>
        {t('Sign in')}
      </Button>
    );
  }

  // no-access is reported, not acted on; unreachable has nothing to retry to.  return null;
};

export default GridRowActions;
