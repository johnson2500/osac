import { Card, CardBody, CardTitle } from '@patternfly/react-core';
import { Skeleton } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useTranslation } from '@osac/ui-components/hooks/useTranslation';

import { GRID_STAT_QUERIES } from './overview-queries';
import type { GridAccess } from './types';
import { useGridsOverview } from './useGridsOverview';

interface GridsOverviewProps {
  grids: GridAccess[];
}

/** Formats one stat's value the way its dashboard panel does. */
const formatStatValue = (id: string, value: number): string => {
  if (id === 'errorRate' || id === 'gpu') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (id === 'latency') {
    return `${Math.round(value)} ms`;
  }
  return value.toLocaleString();
};

/**
 * The cross-grid overview (Phase 4 v1): the same monitoring stats fanned out
 * to every connected grid hub and merged here — one row per grid, plus a
 * totals row for the additive stats. A grid a query could not reach shows
 * its status instead of a value; it degrades alone, never the overview.
 */
const GridsOverview = ({ grids }: GridsOverviewProps) => {
  const { t } = useTranslation();
  const { rows, isLoading } = useGridsOverview(grids);

  if (rows.length === 0 && !isLoading) {
    return null;
  }

  const statLabel = (id: string): string =>
    ({
      requests: t('Requests'),
      errorRate: t('Error rate'),
      latency: t('Avg latency'),
      gpu: t('Avg GPU utilization'),
    })[id] ?? id;

  return (
    <Card>
      <CardTitle>{t('Cross-grid overview (last 24h)')}</CardTitle>
      <CardBody>
        {isLoading && rows.length === 0 ? (
          <Skeleton height="60px" width="100%" />
        ) : (
          <Table aria-label="Cross-grid overview" variant="compact" borders>
            <Thead>
              <Tr>
                <Th>{t('Grid')}</Th>
                {GRID_STAT_QUERIES.map((stat) => (
                  <Th key={stat.id}>{statLabel(stat.id)}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.grid}>
                  <Td dataLabel="Grid">{row.grid}</Td>
                  {GRID_STAT_QUERIES.map((stat) => {
                    const cell = row.stats[stat.id];
                    return (
                      <Td key={stat.id} dataLabel={statLabel(stat.id)}>
                        {cell?.status === 'connected' && cell.value !== undefined
                          ? formatStatValue(stat.id, cell.value)
                          : '—'}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
              <Tr>
                <Td dataLabel="Grid">{t('Total')}</Td>
                {GRID_STAT_QUERIES.map((stat) => {
                  if (stat.aggregate !== 'sum') {
                    // Rates and averages do not add up across grids.
                    return (
                      <Td key={stat.id} dataLabel={statLabel(stat.id)}>
                        —
                      </Td>
                    );
                  }
                  const total = rows.reduce(
                    (sum, row) => sum + (row.stats[stat.id]?.value ?? 0),
                    0,
                  );
                  return (
                    <Td key={stat.id} dataLabel={statLabel(stat.id)}>
                      {formatStatValue(stat.id, total)}
                    </Td>
                  );
                })}
              </Tr>
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
};

export default GridsOverview;
