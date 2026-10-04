import { Alert } from 'react-native';
import { NAME_CONFLICT_COPY } from '@mplayer/core';
import type { NameConflictDecisions, PlaylistNameConflict } from '@mplayer/core';

/**
 * 移动端「同名异源」确认（#560）——adapter `resolveNameConflict` 接缝的 RN 渲染。
 *
 * core 的 `writeSongsToPlaylist` 在目标歌单里发现「同名同歌手、但来自另一个平台」的歌时，
 * 会把**整批**冲突一次性回调给宿主：答 `add` = 照常并入，答 `skip` = 放弃这些歌。
 * 移动端**批量腿此前不传这个回调**，core 于是走「默认并入」——用户没得拒绝，
 * 同一个动作在桌面会问、在移动端不问。
 *
 * 文案取 core 的 `NAME_CONFLICT_COPY`：与桌面 `BatchAddToPlaylistModal` 问的是同一句话。
 *
 * `cancelable: false` + `onDismiss` 兜底：本函数返回的 Promise 是写入路径上的**等待点**，
 * 弹层若被返回键/点外部吃掉而永不 resolve，这次写入会**静默挂住**（既不成功也不失败）。
 *
 * 范围：只覆盖 adapter 的整批接缝。链接导入腿**有意不接**——core 与桌面
 * `importService.importDepsFor` 的口径都是「导入是无人值守的整批操作，走默认并入」，
 * 接上去反而会破坏这条既有的双端一致。
 */
export function promptNameConflict(
  conflicts: readonly PlaylistNameConflict[],
): Promise<NameConflictDecisions> {
  return new Promise((resolve) => {
    Alert.alert(
      NAME_CONFLICT_COPY.title,
      NAME_CONFLICT_COPY.message(conflicts.length),
      [
        { text: NAME_CONFLICT_COPY.cancelText, style: 'cancel', onPress: () => resolve('skip') },
        { text: NAME_CONFLICT_COPY.confirmText, onPress: () => resolve('add') },
      ],
      { cancelable: false, onDismiss: () => resolve('skip') },
    );
  });
}
