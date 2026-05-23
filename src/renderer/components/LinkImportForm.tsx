import React from 'react';
import { Input, Button, Alert } from 'antd';
import { Link, Loader2 } from 'lucide-react';

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
        通过网易云歌单链接导入歌曲
      </div>
      <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        支持的格式：
      </div>
      <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: '1.6' }}>
        <div>• https://music.163.com/#/playlist?id=xxx</div>
        <div>• https://music.163.com/playlist?id=xxx</div>
        <div>• http://163cn.tv/xxx</div>
      </div>
      <Input
        value={linkUrl}
        onChange={(e) => onLinkUrlChange(e.target.value)}
        placeholder="请输入网易云歌单链接"
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
        style={{ backgroundColor: 'var(--accent-color)' }}
      >
        {loading ? '解析中...' : '解析链接'}
      </Button>
    </div>
  );
};

export default LinkImportForm;
