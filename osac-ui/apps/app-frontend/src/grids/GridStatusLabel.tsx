import {
  ResourceStatusLabel,
  type StatusKind,
} from '@osac/ui-components/components/Resource/ResourceStatusLabel';
import { useTranslation } from '@osac/ui-components/hooks/useTranslation';

import type { GridAccessStatus } from './types';

interface GridStatusLabelProps {
  status: GridAccessStatus;
}

const STATUS_KIND: Record<GridAccessStatus, StatusKind> = {
  connected: 'ready',
  'sign-in-required': 'progressing',
  'session-expired': 'progressing',
  'no-access': 'failed',
  unreachable: 'unspecified',
};

const GridStatusLabel = ({ status }: GridStatusLabelProps) => {
  const { t } = useTranslation();

  const text = {
    connected: t('Connected'),
    'sign-in-required': t('Sign-in required'),
    'session-expired': t('Session expired'),
    'no-access': t('No access'),
    unreachable: t('Unreachable'),
  }[status];

  return <ResourceStatusLabel status={STATUS_KIND[status]} text={text} />;
};

export default GridStatusLabel;
