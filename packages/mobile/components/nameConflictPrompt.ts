import { Alert } from 'react-native';
import { NAME_CONFLICT_COPY } from '@mplayer/core';
import type { NameConflictDecisions, PlaylistNameConflict } from '@mplayer/core';

/**
 * 移动端「同名异源」确认（#560）——adapter `resolveNameConflict` 接缝的 RN 渲染。
 * `cancelable: false` + `onDismiss` 兜底：本函数返回的 Promise 是写入路径上的**等待点**，弹层若被返
 * 回键/点外部吃掉而永不 resolve，这次写入会**静默挂住**（既不成功也不失败）。
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
