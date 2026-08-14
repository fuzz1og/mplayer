import React, { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Switch, message } from 'antd';
import { IpcClient } from '@/renderer/services/IpcClient';

/**
 * TLS 指纹伪装险情开关（T10 spec #156，仅桌面）。
 * 默认关；开启后桌面 weapi 请求附带指纹特征调整（自定义 https agent + 附加请求头）。
 * 能力边界：Node 层无法伪造完整 JA3/JA4，此为 best-effort 特征偏置，用于对抗
 * 基础 UA/头级风控；若上游做精确 ClientHello 指纹比对则不足以绕过。
 */
const TlsFingerprintSection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<void> => {
    try {
      const value = await IpcClient.invoke<boolean>('settings:getTlsFingerprint');
      setEnabled(!!value);
    } catch (error) {
      console.error('加载 TLS 指纹伪装设置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleChange = async (value: boolean): Promise<void> => {
    setEnabled(value);
    try {
      await IpcClient.invoke('settings:setTlsFingerprint', value);
      message.success(value ? '已开启 TLS 指纹伪装' : '已关闭 TLS 指纹伪装');
    } catch (error) {
      console.error('保存 TLS 指纹伪装设置失败:', error);
      void load(); // 回滚到已保存状态
    }
  };

  return (
    <section id="tls-fingerprint" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Fingerprint size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>TLS 指纹伪装（险情开关）</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Switch checked={enabled} loading={loading} onChange={(v) => void handleChange(v)} />
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
            {enabled ? '已开启' : '已关闭'}
          </span>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 0, lineHeight: 1.6, marginTop: '12px' }}>
          默认关闭。开启后网易云 weapi 请求附带指纹特征调整（自定义 HTTPS agent 与请求头），
          用于对抗基础的 UA/请求头级风控。受限于 Node 无法伪造完整 JA3/JA4 指纹，此为
          尽力而为的特征偏置，仅桌面生效、移动端不受影响；如遇网络异常可关闭恢复默认。
        </p>
      </div>
    </section>
  );
};

export default TlsFingerprintSection;
