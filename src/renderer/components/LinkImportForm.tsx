import React from 'react';
import { Input, Button, Alert } from 'antd';

interface LinkImportFormProps {
  linkUrl: string;
  onLinkUrlChange: (url: string) => void;
  onParse: () => void;
  loading: boolean;
  error: string | null;
}

const LinkImportForm: React.FC<LinkImportFormProps> = ({
  linkUrl,
  onLinkUrlChange,
  onParse,
  loading,
  error
}) => {
  return (
    <div>
      <div style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
        通过歌单链接导入歌曲
      </div>
      <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        支持的格式：
      </div>
      <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: '1.6' }}>
        <div>• 网易云: https://music.163.com/#/playlist?id=xxx</div>
        <div>• 网易云: https://music.163.com/playlist?id=xxx</div>
        <div>• 网易云短链接: http://163cn.tv/xxx</div>
        <div>• QQ音乐: https://c6.y.qq.com/base/fcgi-bin/u?__=xxx</div>
        <div>• QQ音乐: https://y.qq.com/n/ryqq/playlist/xxx</div>
        <div>• QQ音乐: …/taoge.html?id=xxx（手机分享页）</div>
      </div>
      <Input
        value={linkUrl}
        onChange={(e) => onLinkUrlChange(e.target.value)}
        placeholder="请输入歌单链接（支持网易云和QQ音乐）"
        style={{ fontSize: '14px', marginBottom: '12px' }}
        disabled={loading}
      />
      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          style={{ marginBottom: '12px' }}
        />
      )}
      <Button
        type="primary"
        onClick={onParse}
        disabled={loading || !linkUrl.trim()}
        loading={loading}
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {loading ? '解析中...' : '解析链接'}
      </Button>
    </div>
  );
};

export default LinkImportForm;
