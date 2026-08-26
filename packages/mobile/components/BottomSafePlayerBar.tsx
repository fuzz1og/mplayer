import { SafeAreaView } from 'react-native-safe-area-context';
import ChromeBlur from './ChromeBlur';
import PlayerBar from './PlayerBar';

/**
 * 栈页面（无 tab 栏）的迷你播放栏：安全区条与播放栏合成一整块 ChromeBlur
 * 玻璃板，与 tab 页 BottomChrome 的行为对齐（原先安全区是实色 bgSurface，
 * tab 页却连安全区一起玻璃化——#250 遗留不一致）。
 * 无 blurTarget / 减弱透明度场景由 ChromeBlur 自带降级路径兜底。
 */
export default function BottomSafePlayerBar() {
  return (
    <ChromeBlur>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
        <PlayerBar />
      </SafeAreaView>
    </ChromeBlur>
  );
}
