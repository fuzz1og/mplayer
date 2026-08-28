import React, { useState, useCallback } from 'react';
import { Modal, Button, Progress, message } from 'antd';
import { Upload, Check, X, Clock, Loader2, AlertCircle } from 'lucide-react';
import { importFromLink, parsePlaylistUrl, type SourceType, type ProgressState, type ImportResult } from '@/renderer/services/importService';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import LinkImportForm from './LinkImportForm';
import LinkPreviewTable from './LinkPreviewTable';
import type { Song } from '@mplayer/core';
import { SOURCE_COLORS } from '@/renderer/constants/sourceConfig';

const SOURCE_LABELS: Record<SourceType, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  migu: '咪咕',
  qianqian: '千千',
  soda: '汽水',
};

interface ImportPlaylistModalProps {
  open: boolean;
  playlistId: number;
  existingSongs: Song[];
  onClose: () => void;
  onImported: () => void;
}

const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({
  open,
  playlistId,
  existingSongs,
  onClose,
  onImported,
}) => {
  const [step, setStep] = useState<'input' | 'progress' | 'result'>('input');

  // 链接导入状态
  const [linkUrl, setLinkUrl] = useState('');
  const [parsedLinkSongs, setParsedLinkSongs] = useState<Song[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, setSelectedSongIds] = useState<Set<string>>(new Set());

  // 共享状态
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  // 链接解析处理
  const handleParseLink = useCallback(async () => {
    if (!linkUrl.trim()) {
      message.warning('请输入链接');
      return;
    }

    let urlInfo = parsePlaylistUrl(linkUrl);
    if (!urlInfo) {
      setLinkError('请输入有效的歌单链接（支持网易云和QQ音乐）');
      return;
    }

    setLinkLoading(true);
    setLinkError(null);

    try {
      let songs: Song[] = [];
      if (urlInfo.type === 'qq') {
        // QQ 原生歌单接口（#280）：直链 parsePlaylistUrl 已带出歌单 id；短链传原 url，
        // core 侧经 transport 跟随 302 解析 disstid（无需走主进程白名单解析腿）。
        // 曲目 url 留空，播放时由 resolvePlayableSongRouted 路由解析。
        songs = await callMusicApi('getQqPlaylistSongs', urlInfo.id ?? urlInfo.url!);
      } else {
        if (urlInfo.type === 'netease-short') {
          // 短链渲染层无法跟随跨域 302：主进程解析出落地 URL 后再取歌单 id
          const finalUrl = await callMusicApi('resolvePlaylistLink', urlInfo.url!);
          urlInfo = parsePlaylistUrl(finalUrl);
          if (!urlInfo || urlInfo.type !== 'netease') {
            setLinkError('短链解析失败，未能定位到网易云歌单');
            return;
          }
        }
        const full = await callMusicApi('getPlaylistSongs', 'netease', Number(urlInfo.id), 0, 0);
        songs = full.songs;
      }

      if (songs.length === 0) {
        setLinkError('歌单不存在或没有歌曲');
        return;
      }

      setParsedLinkSongs(songs);
      setSelectedSongIds(new Set(songs.map((song: { id: string }) => song.id)));
    } catch (error) {
      console.error('[LinkImport] 解析链接失败:', error);
      // core 侧语义错误（歌单不存在/隐私/短链失效/歌曲链接）直接透出给用户
      setLinkError(error instanceof Error && error.message ? error.message : '解析链接失败，请检查网络连接');
    } finally {
      setLinkLoading(false);
    }
  }, [linkUrl]);

  // 链接导入处理
  const handleLinkImport = useCallback(async (selectedIds: Set<string>) => {
    if (selectedIds.size === 0) {
      message.warning('请选择要导入的歌曲');
      return;
    }

    setStep('progress');
    setImporting(true);

    try {
      const finalResult = await importFromLink(
        playlistId,
        parsedLinkSongs,
        selectedIds,
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
  }, [playlistId, parsedLinkSongs, existingSongs]);

  const handleDone = () => {
    if (result && result.successes.length > 0) {
      onImported();
    }
    setStep('input');
    setLinkUrl('');
    setParsedLinkSongs([]);
    setSelectedSongIds(new Set());
    setLinkError(null);
    setProgress(null);
    setResult(null);
    onClose();
  };

  // 渲染输入步骤（链接导入）
  const renderInput = () => (
    <div>
      <LinkImportForm
        linkUrl={linkUrl}
        onLinkUrlChange={setLinkUrl}
        onParse={handleParseLink}
        loading={linkLoading}
        error={linkError}
      />
      {parsedLinkSongs.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <LinkPreviewTable
            songs={parsedLinkSongs}
            onConfirm={(ids) => {
              setSelectedSongIds(ids);
              handleLinkImport(ids);
            }}
            onCancel={() => {
              setParsedLinkSongs([]);
              setSelectedSongIds(new Set());
            }}
          />
        </div>
      )}
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
          <Progress percent={percent} strokeColor="var(--accent)" />
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            {progress.found + progress.skipped + progress.failed} / {progress.total}
            {' | '}<Check size={12} style={{ verticalAlign: '-2px' }} /> {progress.found} 已找到{' '}
            {progress.skipped > 0 && <><Clock size={12} style={{ verticalAlign: '-2px' }} /> {progress.skipped} 已跳过 </>}
            {progress.failed > 0 && <><X size={12} style={{ verticalAlign: '-2px' }} /> {progress.failed} 失败</>}
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
              {s.status === 'searching' && <Loader2 size={14} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />}
              {s.status === 'found' && <Check size={14} color="var(--success)" />}
              {s.status === 'skipped' && <Clock size={14} color="var(--text-tertiary)" />}
              {s.status === 'failed' && <X size={14} color="var(--danger)" />}
              <span style={{
                color: s.status === 'failed' ? 'var(--danger)' : s.status === 'found' ? 'var(--success)' : 'var(--text-secondary)',
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
            <Check size={24} color="var(--success)" style={{ marginBottom: '8px' }} />
          ) : (
            <AlertCircle size={24} color="var(--warning)" style={{ marginBottom: '8px' }} />
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
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--danger)', marginBottom: '8px' }}>
              以下歌曲未找到匹配：
            </div>
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {result.failures.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--danger-subtle)', marginBottom: '4px', fontSize: '13px' }}>
                  <X size={14} color="var(--danger)" />
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
      {step === 'input' && renderInput()}
      {step === 'progress' && renderProgress()}
      {step === 'result' && (
        <>
          {renderResult()}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button type="primary" onClick={handleDone} style={{ backgroundColor: 'var(--accent)' }}>
              完成
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default ImportPlaylistModal;
