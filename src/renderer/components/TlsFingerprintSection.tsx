import React, { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Group, Row, Section, Switch, useToast } from '@/renderer/ui';

/**
 * TLS 指纹伪装险情开关（T10 spec #156，仅桌面）。
 * 默认关；开启后桌面 weapi 请求附带指纹特征调整（自定义 https agent + 附加请求头）。
 */
const TlsFingerprintSection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const { show } = useToast();

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
      show(value ? '已开启 TLS 指纹伪装' : '已关闭 TLS 指纹伪装', { tone: 'success' });
    } catch (error) {
      console.error('保存 TLS 指纹伪装设置失败:', error);
      show('保存失败，已恢复原设置', { tone: 'danger' });
      void load();
    }
  };

  return (
    <section id="tls-fingerprint">
      <Section
        title="TLS 指纹"
        footer="默认关闭。开启后网易云 weapi 请求附带指纹特征调整（自定义 HTTPS agent 与请求头），用于对抗基础的 UA/请求头级风控。受限于 Node 无法伪造完整 JA3/JA4 指纹，此为尽力而为的特征偏置，仅桌面生效；如遇网络异常可关闭恢复默认。"
      >
        <Group>
          <Row
            icon={<Fingerprint size={13} />}
            label="指纹伪装"
            detail={loading ? '读取中…' : enabled ? '已开启' : '已关闭'}
            trailing={
              <Switch
                checked={enabled}
                disabled={loading}
                onChange={(value) => void handleChange(value)}
                ariaLabel="TLS 指纹伪装"
              />
            }
          />
        </Group>
      </Section>
    </section>
  );
};

export default TlsFingerprintSection;
