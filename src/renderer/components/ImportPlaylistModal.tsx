import React, { useState, useCallback } from 'react';
import { Upload, Check, X, Clock, Loader2, AlertCircle } from 'lucide-react';
import { importFromLink, parsePlaylistUrl, type SourceType, type ProgressState, type ImportResult } from '@/renderer/services/importService';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { toast } from '@/renderer/services/toastStore';
import { Button, Dialog, Progress, Tag } from '@/renderer/ui';
import LinkImportForm from './LinkImportForm';
import LinkPreviewTable from './LinkPreviewTable';
import type { Song } from '@mplayer/core';

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

  const [linkUrl, setLinkUrl] = useState('');
  const [parsedLinkSongs, setParsedLinkSongs] = useState<Song[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, setSelectedSongIds] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  const handleParseLink = useCallback(async () => {
    if (!linkUrl.trim()) {
      toast.warning('请输入链接');
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
        // QQ 原生歌单接口（#280）：直链 parsePlaylistUrl 已带出歌单 id；短链传原 url。
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

  const handleLinkImport = useCallback(async (selectedIds: Set<string>) => {
    if (selectedIds.size === 0) {
      toast.warning('请选择要导入的歌曲');
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
      toast.error('导入失败: ' + (error instanceof Error ? error.message : '未知错误'));
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
        <div className="import-playlist__preview">
          <LinkPreviewTable
            songs={parsedLinkSongs}
            onConfirm={(ids) => {
              setSelectedSongIds(ids);
              void handleLinkImport(ids);
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
      <div className="import-playlist">
        <Progress value={percent} ariaLabel="导入进度" />

        <div className="import-playlist__counts">
          <span>{progress.found + progress.skipped + progress.failed} / {progress.total}</span>
          <Tag tone="success"><Check size={12} aria-hidden="true" /> {progress.found} 已找到</Tag>
          {progress.skipped > 0 ? <Tag><Clock size={12} aria-hidden="true" /> {progress.skipped} 已跳过</Tag> : null}
          {progress.failed > 0 ? <Tag tone="danger"><X size={12} aria-hidden="true" /> {progress.failed} 失败</Tag> : null}
        </div>

        {progress.currentSource && (
          <div className="import-playlist__current">正在搜索: {SOURCE_LABELS[progress.currentSource as SourceType]}</div>
        )}

        <div className="import-playlist__rows">
          {progress.statuses.map((s, i) => (
            <div key={i} className="import-playlist__row" data-status={s.status}>
              {s.status === 'pending' && <Clock size={13} aria-hidden="true" />}
              {s.status === 'searching' && <Loader2 size={13} aria-hidden="true" className="import-playlist__spin" />}
              {s.status === 'found' && <Check size={13} aria-hidden="true" />}
              {s.status === 'skipped' && <Clock size={13} aria-hidden="true" />}
              {s.status === 'failed' && <X size={13} aria-hidden="true" />}
              <span className="import-playlist__line">{s.line}</span>
              {s.source ? <Tag>{SOURCE_LABELS[s.source as SourceType]}</Tag> : null}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderResult = () => {
    if (!result) return null;
    return (
      <div className="import-playlist">
        <div className="import-playlist__summary">
          {result.failures.length === 0 ? (
            <Check size={22} color="var(--success)" aria-hidden="true" />
          ) : (
            <AlertCircle size={22} color="var(--warning)" aria-hidden="true" />
          )}
          <div className="import-playlist__summary-title">导入完成</div>
          <div className="import-playlist__summary-text">
            成功导入 {result.successes.length} 首
            {result.skips.length > 0 && `，${result.skips.length} 首已跳过`}
            {result.failures.length > 0 && `，${result.failures.length} 首未找到`}
          </div>
        </div>

        {result.failures.length > 0 && (
          <div className="import-playlist__failures">
            <div className="import-playlist__failures-title">以下歌曲未找到匹配：</div>
            {result.failures.map((f, i) => (
              <div key={i} className="import-playlist__failure">
                <X size={13} color="var(--danger)" aria-hidden="true" />
                <span className="import-playlist__failure-line">{f.line}</span>
                <span className="import-playlist__failure-reason">{f.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      title={
        <span className="import-playlist__title">
          <Upload size={16} aria-hidden="true" />
          导入歌单
        </span>
      }
      onClose={importing ? () => undefined : onClose}
      size="md"
      footer={
        step === 'result' ? (
          <Button variant="primary" onClick={handleDone}>
            完成
          </Button>
        ) : undefined
      }
    >
      {step === 'input' && renderInput()}
      {step === 'progress' && renderProgress()}
      {step === 'result' && renderResult()}
    </Dialog>
  );
};

export default ImportPlaylistModal;
