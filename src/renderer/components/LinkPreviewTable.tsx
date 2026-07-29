import React, { useState, useEffect } from 'react';
import { Checkbox, Button, Table, Tag } from 'antd';
import type { SongBase } from '@mplayer/core';

interface LinkPreviewTableProps {
  songs: SongBase[];
  onConfirm: (selectedIds: Set<string>) => void;
  onCancel: () => void;
}

const sourceColorMap: Record<string, string> = {
  netease: '#FF6B6B',
  qq: '#49B8FF',
  kugou: '#FF8C00',
  migu: '#C20C0C',
  kuwo: '#FF6F00',
  qianqian: '#00A1D6',
  soda: '#1E90FF',
  local: '#999999',
};

const sourceLabelMap: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

const LinkPreviewTable: React.FC<LinkPreviewTableProps> = ({
  songs,
  onConfirm,
  onCancel
}) => {
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Select all by default
  useEffect(() => {
    setSelectedRowKeys(songs.map(song => song.id));
  }, [songs]);

  const handleConfirm = () => {
    onConfirm(new Set(selectedRowKeys as string[]));
  };

  const columns = [
    {
      title: '',
      dataIndex: 'id',
      key: 'select',
      width: 50,
      render: (id: string) => (
        <Checkbox
          checked={selectedRowKeys.includes(id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedRowKeys(prev => [...prev, id]);
            } else {
              setSelectedRowKeys(prev => prev.filter(key => key !== id));
            }
          }}
        />
      )
    },
    {
      title: '歌名',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '歌手',
      dataIndex: 'artist',
      key: 'artist',
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      key: 'sourceType',
      render: (source: string) => (
        <Tag color={sourceColorMap[source] || '#999999'}>
          {sourceLabelMap[source] || source}
        </Tag>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
        共 {songs.length} 首歌曲，请选择要导入的歌曲
      </div>
      <Table
        dataSource={songs}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
        style={{ marginBottom: '16px' }}
        scroll={{ y: 300 }}
      />
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>取消</Button>
        <Button
          type="primary"
          onClick={handleConfirm}
          disabled={selectedRowKeys.length === 0}
          style={{ backgroundColor: 'var(--accent-color)' }}
        >
          导入选中歌曲 ({selectedRowKeys.length})
        </Button>
      </div>
    </div>
  );
};

export default LinkPreviewTable;
