/**
 * The v1 cross-grid overview query set: the same queries fanned out to every
 * connected grid hub and merged in the UI (the settled Phase 4 decision —
 * fan-out + client-side merge only, no central aggregation).
 *
 * The queries mirror the stat panels of the monitoring stack's Clusters
 * dashboard (demo-cluster's dashboard-0-clusters, the shape the ai-grid-o11y
 * set deploys), with the dashboard's [$__range] bound to a fixed 24 h window.
 * When the real hubs' dashboard queries are pinned, they replace these
 * strings — nothing else changes.
 *
 * The fleet series' missing cluster label (rbac-query-proxy gap) is why these
 * are grid-level aggregates only: a per-cluster breakdown across grids needs
 * cluster + grid labels on every series first.
 */

/** The fixed window the overview aggregates over. */
export const OVERVIEW_WINDOW = '24h';

/**
 * The Perses project every grid hub serves its monitoring from. The Cluster
 * Observability Operator maps the ai-grid-monitoring namespace to the Perses
 * project one-to-one, and the same ai-grid-o11y set is deployed on every
 * grid, so the project name is a constant.
 */
export const MONITORING_PROJECT = 'ai-grid-monitoring';

/** The datasource kind the overview queries run against (Loki on the MVP). */
export const OVERVIEW_DATASOURCE_KIND = 'LokiDatasource';

export interface GridStatQuery {
  /** Identifies the stat in results and the i18n label key. */
  id: 'requests' | 'errorRate' | 'latency' | 'gpu';
  query: string;
  /**
   * How a cross-grid total is merged: 'sum' for additive counts, 'none' for
   * rates and averages, where summing across grids would be meaningless.
   */
  aggregate: 'sum' | 'none';
}

export const GRID_STAT_QUERIES: GridStatQuery[] = [
  {
    id: 'requests',
    query:
      `sum(count_over_time({service_name="ai-grid-inference", response_type="hit"}[${OVERVIEW_WINDOW}]))` +
      ' or vector(0)',
    aggregate: 'sum',
  },
  {
    id: 'errorRate',
    query:
      `(sum(count_over_time({service_name="ai-grid-inference", response_type="error"}[${OVERVIEW_WINDOW}])) or vector(0))` +
      ` / (sum(count_over_time({service_name="ai-grid-inference"}[${OVERVIEW_WINDOW}])) or vector(1))`,
    aggregate: 'none',
  },
  {
    id: 'latency',
    query:
      `avg(avg_over_time({service_name="ai-grid-inference"} | json | unwrap latency_ms[${OVERVIEW_WINDOW}]))` +
      ' or vector(0)',
    aggregate: 'none',
  },
  {
    id: 'gpu',
    query:
      `avg(avg_over_time({service_name="ai-grid-node"} | json | unwrap gpu_util[${OVERVIEW_WINDOW}]))` +
      ' or vector(0)',
    aggregate: 'none',
  },
];
