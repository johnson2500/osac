import { Card, CardBody, CardTitle, Skeleton } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useTranslation } from '@osac/ui-components/hooks/useTranslation';

import GridStatusLabel from './GridStatusLabel';
import { GRID_STAT_QUERIES, type GridStatFormat, type GridStatId } from './overview-queries';
import type { GridAccess, GridAccessStatus } from './types';
import { type GridsOverviewRow, useGridsOverview } from './useGridsOverview';

interface GridsOverviewProps {
  grids: GridAccess[];
}

/** Formats one stat value the way its dashboard panel does. */
const formatStatValue = (format: GridStatFormat, value: number): string => {
  switch (format) {
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'milliseconds':
      return `${Math.round(value)} ms`;
    case 'count':
      return value.toLocaleString();
  }
};

/**
 * The status a degraded row shows: the first non-connected status among its
 * stats (a grid that could not be queried reports the same status in every
 * cell), or undefined when everything answered.
 */
const rowStatus = (row: GridsOverviewRow): GridAccessStatus | undefined =>
  GRID_STAT_QUERIES.map((stat) => row.stats[stat.id]?.status).find(
    (status) => status !== undefined && status !== 'connected',
  );

/**
 * The cross-grid overview (Phase 4 v1): the same monitoring stats fanned out
 * to every connected grid hub and merged here — one row per grid, plus a
 * totals row for the additive stats. A grid a query could not reach shows
 * its status next to its name; it degrades alone, never the overview.
 */
const GridsOverview = ({ grids }: GridsOverviewProps) => {
  const { t } = useTranslation();
  const { rows, isLoading } = useGridsOverview(grids);

  // Literal keys per stat id: the i18n extractor only sees t() with literal
  // strings, so the column headers cannot come from a variable key.
  const statLabels: Record<GridStatId, string> = {
    requests: t('Requests'),
    errorRate: t('Error rate'),
    latency: t('Avg latency'),
    gpu: t('Avg GPU utilization'),
  };

  if (rows.length === 0 && !isLoading) {
    return null;
  }

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
                  <Th key={stat.id}>{statLabels[stat.id]}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const status = rowStatus(row);
                return (
                  <Tr key={row.grid}>
                    <Td dataLabel="Grid">
                      {row.grid}
                      {status && <GridStatusLabel status={status} />}
                    </Td>
                    {GRID_STAT_QUERIES.map((stat) => {
                      const cell = row.stats[stat.id];
                      return (
                        <Td key={stat.id} dataLabel={statLabels[stat.id]}>
                          {cell?.status === 'connected' && cell.value !== undefined
                            ? formatStatValue(stat.format, cell.value)
                            : '—'}
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
              <Tr>
                <Td dataLabel="Grid">{t('Total')}</Td>
                {GRID_STAT_QUERIES.map((stat) => {
                  if (stat.aggregate !== 'sum') {
                    // Rates and averages do not add up across grids.
                    return (
                      <Td key={stat.id} dataLabel={statLabels[stat.id]}>
                        —
                      </Td>
                    );
                  }
                  const total = rows.reduce(
                    (sum, row) => sum + (row.stats[stat.id]?.value ?? 0),
                    0,
                  );
                  return (
                    <Td key={stat.id} dataLabel={statLabels[stat.id]}>
                      {formatStatValue(stat.format, total)}
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
