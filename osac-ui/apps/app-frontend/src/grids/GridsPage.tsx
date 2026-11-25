import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import ListPage from '@osac/ui-components/components/Page/ListPage';
import ListPageBody from '@osac/ui-components/components/Page/ListPageBody';
import { SubtleContent } from '@osac/ui-components/components/SubtleContent/SubtleContent';
import { useTranslation } from '@osac/ui-components/hooks/useTranslation';

import GridRowActions from './GridRowActions';
import GridsOverview from './GridsOverview';
import GridStatusLabel from './GridStatusLabel';
import { useGrids } from './useGrids';

/**
 * The AI Grids page: every grid the OSAC UI proxy serves, with this user's
 * access to each — connected, needing the one-time silent sign-in, refused by
 * the hub, or unreachable. A refused grid is reported, not hidden.
 */
const GridsPage = () => {
  const { t } = useTranslation();
  const { grids, isLoading, error } = useGrids();

  return (
    <ListPage
      title={t('AI Grids')}
      description={t(
        'AI Grid hubs federate your OSAC sign-in. The first visit to a grid may ask you to sign in once.',
      )}
      error={error}
    >
      <ListPageBody isLoading={isLoading} error={error}>
        {grids.length === 0 ? (
          <SubtleContent component="p">{t('No AI Grids are configured.')}</SubtleContent>
        ) : (
          <Table aria-label="AI Grids" variant="compact" borders>
            <Thead>
              <Tr>
                <Th>{t('Grid')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Grid user')}</Th>
                <Th screenReaderText={t('Actions')} />
              </Tr>
            </Thead>
            <Tbody>
              {grids.map((grid) => (
                <Tr key={grid.id}>
                  <Td dataLabel="Grid">{grid.id}</Td>
                  <Td dataLabel="Status">
                    <GridStatusLabel status={grid.status} />
                  </Td>
                  <Td dataLabel="Grid user">{grid.username ?? '—'}</Td>
                  <Td dataLabel="">
                    <GridRowActions grid={grid} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        <GridsOverview grids={grids} />
      </ListPageBody>
    </ListPage>
  );
};

export default GridsPage;
