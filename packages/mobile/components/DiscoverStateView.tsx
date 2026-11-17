import { AlertCircle, RefreshCw } from 'lucide-react-native';
import EmptyState from './EmptyState';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** 空态用中性图标；错态用 dangerText */
  tone?: 'empty' | 'error';
}

/** 发现页空态 / 错态：统一走 EmptyState 的内嵌变体，每个 tab 独立使用。 */
export default function DiscoverStateView({ title, message, actionLabel = '重试', onAction, tone = 'error' }: Props) {
  const { colors } = useTheme();
  return (
    <EmptyState
      variant="embedded"
      icon={AlertCircle}
      iconColor={tone === 'error' ? colors.dangerText : colors.textDisabled}
      title={title}
      subtitle={message}
      actionLabel={onAction ? actionLabel : undefined}
      actionIcon={RefreshCw}
      onAction={onAction}
    />
  );
}
