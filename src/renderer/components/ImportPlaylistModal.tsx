import React, { useState, useCallback } from 'react';
import { Modal, Input, Button, Progress, message } from 'antd';
import { Upload, Check, X, Clock } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { importSongs, parseSongList, type SourceType, type ProgressState, type ImportResult } from '@/renderer/services/importService';
import type { Song } from '@/shared/types/song';

const SOURCE_LABELS: Record<SourceType, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
};

const SOURCE_COLORS: Record<SourceType, string> = {
  netease: '#FF6B6B',
  qq: '#49B8FF',
  kugou: '#FF8C00',
};

interface DraggableSourceProps {
  source: SourceType;
  index: number;
}

const DraggableSource: React.FC<DraggableSourceProps> = ({ source, index }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: source });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 12px',
        borderRadius: '14px',
        fontSize: '13px',
        fontWeight: 500,
        backgroundColor: SOURCE_COLORS[source] + '22',
        color: SOURCE_COLORS[source],
        border: `1px solid ${SOURCE_COLORS[source]}44`,
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.6 : 1,
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
        userSelect: 'none',
      }}
    >
      <span style={{ opacity: 0.6, fontSize: '12px' }}>{index + 1}.</span>
      <span>{SOURCE_LABELS[source]}</span>
    </div>
  );
};

interface ImportPlaylistModalProps {
  open: boolean;
  playlistId: number;
  playlistName: string;
  existingSongs: Song[];
  onClose: () => void;
  onImported: () => void;
}

const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({
  open,
  playlistId,
  playlistName,
  existingSongs,
  onClose,
  onImported,
}) => {
  const [step, setStep] = useState<'input' | 'progress' | 'result'>('input');
  const [text, setText] = useState('');
  const [sourceOrder, setSourceOrder] = useState<SourceType[]>(['netease', 'qq', 'kugou']);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sourceOrder.indexOf(active.id as SourceType);
    const newIndex = sourceOrder.indexOf(over.id as SourceType);
    if (oldIndex === -1 || newIndex === -1) return;
    setSourceOrder(arrayMove(sourceOrder, oldIndex, newIndex));
  }, [sourceOrder]);

  const handleStartImport = useCallback(async () => {
    if (!text.trim()) {
      message.warning('请输入歌曲列表');
      return;
    }
    const lines = parseSongList(text);
    if (lines.length === 0) {
      message.warning('未解析到有效的歌曲信息');
      return;
    }

    setStep('progress');
    setImporting(true);

    try {
      const finalResult = await importSongs(
        playlistId,
        text,
        sourceOrder,
        existingSongs,
        (state) => setProgress(state)
      );
      setResult(finalResult);
      setStep('result');
    } catch (error) {
      message.error('导入失败: ' + (error instanceof Error ? error.message : '未知错误'));
      setStep('input');
    } finally {
      setImporting(false);
    }
  }, [text, sourceOrder, playlistId, existingSongs]);

  const handleDone = () => {
    if (result && result.successes.length > 0) {
      onImported();
    }
    setStep('input');
    setText('');
    setProgress(null);
    setResult(null);
    setSourceOrder(['netease', 'qq', 'kugou']);
    onClose();
  };

  const renderInput = () => (
    <div>
      <div style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
        粘贴歌曲列表到歌单「{playlistName}」，每行一首
      </div>
      <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        格式：歌曲名 - 歌手
      </div>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`七里香 - 周杰伦\n童话 - 光良\n泡沫 - G.E.M. 邓紫棋`}
        rows={8}
        style={{ fontSize: '14px', resize: 'vertical', marginBottom: '16px' }}
      />
      <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        搜索源顺序（拖拽调整）：
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sourceOrder} strategy={verticalListSortingStrategy}>
            {sourceOrder.map((source, index) => (
              <DraggableSource key={source} source={source} index={index} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );

  const renderProgress = () => {
    if (!progress) return null;
    const percent = progress.total > 0
      ? Math.round(((progress.found + progress.skipped + progress.failed) / progress.total) * 100)
      : 0;

    return (
      <div>
        <div style={{ marginBottom: '16px' }}>
          <Progress percent={percent} strokeColor="var(--accent-color)" />
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            {progress.found + progress.skipped + progress.failed} / {progress.total}
            {' | '}✅ {progress.found} 已找到{' '}
            {progress.skipped > 0 && <>⏭️ {progress.skipped} 已跳过 </>}
            {progress.failed > 0 && <>❌ {progress.failed} 失败</>}
          </div>
          {progress.currentSource && (
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              正在搜索: {SOURCE_LABELS[progress.currentSource as SourceType]}
            </div>
          )}
        </div>
        <div style={{ maxHeight: '300px', overflow: 'auto', fontSize: '13px' }}>
          {progress.statuses.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              {s.status === 'pending' && <Clock size={14} color="var(--text-tertiary)" />}
              {s.status === 'searching' && <span style={{ color: 'var(--accent-color)' }}>⏳</span>}
              {s.status === 'found' && <Check size={14} color="#00B894" />}
              {s.status === 'skipped' && <span style={{ color: 'var(--text-tertiary)' }}>⏭️</span>}
              {s.status === 'failed' && <X size={14} color="#FF6B6B" />}
              <span style={{
                color: s.status === 'failed' ? '#FF6B6B' : s.status === 'found' ? '#00B894' : 'var(--text-secondary)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {s.line}
              </span>
              {s.source && (
                <span style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: SOURCE_COLORS[s.source as SourceType] + '22', color: SOURCE_COLORS[s.source as SourceType], flexShrink: 0 }}>
                  {SOURCE_LABELS[s.source as SourceType]}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderResult = () => {
    if (!result) return null;
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          {result.failures.length === 0 ? (
            <div style={{ fontSize: '24px', color: '#00B894', marginBottom: '8px' }}>✅</div>
          ) : (
            <div style={{ fontSize: '24px', color: '#FFB800', marginBottom: '8px' }}>⚠️</div>
          )}
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            导入完成
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            成功导入 {result.successes.length} 首
            {result.skips.length > 0 && `，${result.skips.length} 首已跳过`}
            {result.failures.length > 0 && `，${result.failures.length} 首未找到`}
          </div>
        </div>
        {result.failures.length > 0 && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#FF6B6B', marginBottom: '8px' }}>
              以下歌曲未找到匹配：
            </div>
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {result.failures.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', backgroundColor: 'rgba(255,107,107,0.05)', marginBottom: '4px', fontSize: '13px' }}>
                  <X size={14} color="#FF6B6B" />
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{f.line}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>{f.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={!importing ? onClose : undefined}
      footer={null}
      width={560}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Upload size={18} />
          <span>导入歌单</span>
        </div>
      }
      destroyOnClose
    >
      {step === 'input' && (
        <>
          {renderInput()}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleStartImport} style={{ backgroundColor: 'var(--accent-color)' }}>
              开始导入
            </Button>
          </div>
        </>
      )}
      {step === 'progress' && renderProgress()}
      {step === 'result' && (
        <>
          {renderResult()}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button type="primary" onClick={handleDone} style={{ backgroundColor: 'var(--accent-color)' }}>
              完成
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default ImportPlaylistModal;
