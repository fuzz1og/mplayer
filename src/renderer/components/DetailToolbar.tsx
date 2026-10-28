import React from 'react';
import { CheckSquare, Search, X } from 'lucide-react';
import '@/renderer/styles/detail-toolbar.css';

export interface DetailToolbarBatchAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export interface DetailToolbarProps {
  filterValue: string;
  onFilterChange: (value: string) => void;
  /** 过滤命中数 / 全量数：过滤中显示「N / M 首」。 */
  matchedCount: number;
  totalCount: number;
  filterPlaceholder?: string;
  /** 页面没有批量能力时传 false：整条只剩过滤框。 */
  selectable?: boolean;
  selecting: boolean;
  onToggleSelecting: () => void;
  onSelectAll?: () => void;
  allSelected?: boolean;
  selectedCount?: number;
  batchActions?: DetailToolbarBatchAction[];
  /** 批量态下的进度提示（如正在保存排序）。 */
  status?: React.ReactNode;
  className?: string;
}

/**
 * 详情页工具条（#694）：过滤 + 选择/完成 + 批量栏同处一行 40px。
 * 高度是硬约束——它是列表 scrollMargin 的测量锚点，三态必须同高。
 */
const DetailToolbar: React.FC<DetailToolbarProps> = ({
  filterValue,
  onFilterChange,
  matchedCount,
  totalCount,
  filterPlaceholder = '按歌名或歌手过滤',
  selectable = true,
  selecting,
  onToggleSelecting,
  onSelectAll,
  allSelected = false,
  selectedCount = 0,
  batchActions,
  status,
  className,
}) => {
  const isFiltering = filterValue.trim().length > 0;
  const rootClass = className ? 'detail-toolbar ' + className : 'detail-toolbar';

  return (
    <div className={rootClass} data-detail-toolbar>
      <div className="detail-toolbar__filter">
        <Search size={13} aria-hidden="true" className="detail-toolbar__filter-icon" />
        <input
          type="text"
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={filterPlaceholder}
          aria-label={filterPlaceholder}
          autoComplete="off"
          className="detail-toolbar__filter-input"
        />
        {isFiltering && (
          <>
            <span className="detail-toolbar__filter-count">
              {matchedCount} / {totalCount} 首
            </span>
            <button
              type="button"
              onClick={() => onFilterChange('')}
              aria-label="清空过滤"
              title="清空过滤"
              className="detail-toolbar__filter-clear"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>

      {selecting && onSelectAll && (
        <label className="detail-toolbar__select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            aria-label="全选可见歌曲"
            title={isFiltering ? '全选当前过滤结果' : '全选'}
          />
          <span>全选</span>
        </label>
      )}

      {selecting && selectedCount > 0 && (
        <>
          <span className="detail-toolbar__batch-count">已选择 {selectedCount} 项</span>
          <div className="detail-toolbar__batch-actions">
            {(batchActions ?? []).map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                className={
                  'detail-toolbar__batch-btn' +
                  (action.danger ? ' detail-toolbar__batch-btn--danger' : '')
                }
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}

      {status != null && status !== false && (
        <span className="detail-toolbar__status" role="status">
          {status}
        </span>
      )}

      {selectable && (
        <button
          type="button"
          className={
            'detail-toolbar__toggle' + (selecting ? ' detail-toolbar__toggle--primary' : '')
          }
          aria-pressed={selecting}
          onClick={onToggleSelecting}
        >
          {selecting ? '完成' : (
            <>
              <CheckSquare size={14} aria-hidden="true" />
              选择
            </>
          )}
        </button>
      )}
    </div>
  );
};

export default DetailToolbar;
