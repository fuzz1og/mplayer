import React from 'react';
import { Alert, Button, Input } from '@/renderer/ui';

interface LinkImportFormProps {
  linkUrl: string;
  onLinkUrlChange: (url: string) => void;
  onParse: () => void;
  loading: boolean;
  error: string | null;
}

const SUPPORTED = [
  '网易云: https://music.163.com/#/playlist?id=xxx',
  '网易云: https://music.163.com/playlist?id=xxx',
  '网易云短链接: http://163cn.tv/xxx',
  'QQ音乐: https://c6.y.qq.com/base/fcgi-bin/u?__=xxx',
  'QQ音乐: https://y.qq.com/n/ryqq/playlist/xxx',
  'QQ音乐: …/taoge.html?id=xxx（手机分享页）',
];

const LinkImportForm: React.FC<LinkImportFormProps> = ({
  linkUrl,
  onLinkUrlChange,
  onParse,
  loading,
  error
}) => {
  return (
    <div className="link-import">
      <div className="link-import__lead">通过歌单链接导入歌曲</div>
      <div className="link-import__hint">支持的格式：</div>
      <ul className="link-import__formats">
        {SUPPORTED.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Input
        aria-label="歌单链接"
        value={linkUrl}
        onChange={(e) => onLinkUrlChange(e.target.value)}
        placeholder="请输入歌单链接（支持网易云和QQ音乐）"
        disabled={loading}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onParse();
        }}
      />
      {error ? (
        <div className="link-import__error">
          <Alert tone="danger" title={error} />
        </div>
      ) : null}
      <div className="link-import__actions">
        <Button variant="primary" onClick={onParse} disabled={loading || !linkUrl.trim()}>
          {loading ? '解析中…' : '解析链接'}
        </Button>
      </div>
    </div>
  );
};

export default LinkImportForm;
