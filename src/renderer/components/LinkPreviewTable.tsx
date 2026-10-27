import React, { useState, useEffect } from 'react';
import type { SongBase } from '@mplayer/core';
import { Button, Checkbox, Tag } from '@/renderer/ui';
import { SOURCE_COLORS, ALL_SOURCE_COLOR } from '@/renderer/constants/sourceConfig';

interface LinkPreviewTableProps {
  songs: SongBase[];
  onConfirm: (selectedIds: Set<string>) => void;
  onCancel: () => void;
}

const sourceLabelMap: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  qianqian: '千千',
  migu: '咪咕',
  soda: '汽水',
  local: '本地',
};

/**
 * 链接导入预览（1.9.0）：原 antd Table 换成自绘网格 + 行内勾选。
 * 全选默认勾上；确认按钮显示已选数量。
 */
const LinkPreviewTable: React.FC<LinkPreviewTableProps> = ({
  songs,
  onConfirm,
  onCancel
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(songs.map((song) => song.id));
  }, [songs]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((key) => key !== id) : [...prev, id]));
  };

  const allSelected = selectedIds.length === songs.length && songs.length > 0;

  return (
    <div className="link-preview">
      <div className="link-preview__lead">
        共 {songs.length} 首歌曲，已选 {selectedIds.length} 首
      </div>

      <div className="link-preview__grid" role="table" aria-label="待导入歌曲">
        <div className="link-preview__head" role="row">
          <span className="link-preview__cell link-preview__cell--check" role="columnheader">
            <Checkbox
              checked={allSelected}
              onChange={() => setSelectedIds(allSelected ? [] : songs.map((song) => song.id))}
              label={undefined}
              ariaLabel="全选歌曲"
            />
          </span>
          <span className="link-preview__cell" role="columnheader">歌名</span>
          <span className="link-preview__cell" role="columnheader">歌手</span>
          <span className="link-preview__cell link-preview__cell--source" role="columnheader">来源</span>
        </div>

        <div className="link-preview__body">
          {songs.map((song) => {
            const checked = selectedIds.includes(song.id);
            return (
              <div key={song.id} className="link-preview__row" role="row" data-checked={checked || undefined}>
                <span className="link-preview__cell link-preview__cell--check" role="cell">
                  <Checkbox checked={checked} onChange={() => toggle(song.id)} ariaLabel={`选择 ${song.name}`} />
                </span>
                <span className="link-preview__cell link-preview__cell--name" role="cell">{song.name}</span>
                <span className="link-preview__cell" role="cell">{song.artist}</span>
                <span className="link-preview__cell link-preview__cell--source" role="cell">
                  <Tag
                    tone="neutral"
                    title={sourceLabelMap[song.sourceType ?? ''] ?? song.sourceType}
                    className="link-preview__tag"
                    {...{ 'data-source-color': SOURCE_COLORS[song.sourceType as keyof typeof SOURCE_COLORS] || ALL_SOURCE_COLOR }}
                  >
                    {sourceLabelMap[song.sourceType ?? ''] ?? song.sourceType}
                  </Tag>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="link-preview__actions">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="primary"
          onClick={() => onConfirm(new Set(selectedIds))}
          disabled={selectedIds.length === 0}
        >
          导入选中歌曲（{selectedIds.length}）
        </Button>
      </div>
    </div>
  );
};

export default LinkPreviewTable;
