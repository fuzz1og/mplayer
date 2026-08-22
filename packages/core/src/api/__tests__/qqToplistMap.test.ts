import { describe, it, expect } from 'vitest';
import { mapQQToplistItem } from '../musicApi.js';

/**
 * QQ v8 榜单映射测试（#172 正文：热榜数字 id vs 直连 GetVkey songmid 冲突）。
 * GetVkey 按 songmid 键控，数字 id 直连恒为空（与版权状态无关）——
 * 榜单 id 必须优先取 songData.mid，否则整榜 100% 依赖 tier3、探测预取全废。
 */

const RAW_WITH_MID = {
  data: {
    mid: '001auUcH4WQs2V',
    id: 496054946,
    name: '恋人',
    singer: [{ name: '李荣浩' }, { name: '另一人' }],
    album: { mid: '004HaG7p4ZkhXA', name: '黑马' },
  },
};

describe('mapQQToplistItem（QQ 榜单曲 → HotlistSong）', () => {
  it('songmid 存在时 id 取 songmid（直连腿的键），不用数字 id', () => {
    const mapped = mapQQToplistItem(RAW_WITH_MID, 5);
    expect(mapped).not.toBeNull();
    // 回归断言：id 是 songmid 形态，不是数字 id=496054946
    expect(mapped!.id).toBe('001auUcH4WQs2V');
    expect(mapped!.id).not.toBe('496054946');
  });

  it('响应缺失 mid 时兜底用数字 id 字符串', () => {
    const noMid = {
      data: { ...RAW_WITH_MID.data, mid: undefined },
    };
    const mapped = mapQQToplistItem(noMid, 0);
    expect(mapped!.id).toBe('496054946');
  });

  it('mid 与数字 id 均缺失 → 空串（无 id 不误造）', () => {
    const bare = { data: { name: 'x' } };
    const mapped = mapQQToplistItem(bare, 0);
    expect(mapped!.id).toBe('');
  });

  it('歌手拼接 / rank / 封面（album.mid）/ 专辑名映射正确', () => {
    const mapped = mapQQToplistItem(RAW_WITH_MID, 5)!;
    expect(mapped.artists).toBe('李荣浩/另一人');
    expect(mapped.rank).toBe(6);
    expect(mapped.cover).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000004HaG7p4ZkhXA_1.jpg');
    expect(mapped.album).toBe('黑马');
    expect(mapped.name).toBe('恋人');
  });

  it('缺 album.mid → 空封面不构造假 URL', () => {
    const noAlbumMid = { data: { ...RAW_WITH_MID.data, album: { name: '黑马' } } };
    const mapped = mapQQToplistItem(noAlbumMid, 0)!;
    expect(mapped.cover).toBe('');
  });

  it('item 无 data → null（调用方跳过该条）', () => {
    expect(mapQQToplistItem({}, 0)).toBeNull();
    expect(mapQQToplistItem(null, 0)).toBeNull();
  });

  it('整榜形态约束：带 mid 的响应映射后不允许出现纯数字 id', () => {
    const songlist = Array.from({ length: 50 }, (_, i) => ({
      data: { mid: `mid-${i}`, id: 100000 + i, name: `歌${i}`, singer: [{ name: 'a' }], album: { mid: `alb${i}`, name: '专辑' } },
    }));
    const ids = songlist.map((item, i) => mapQQToplistItem(item, i)!.id);
    expect(ids.some((id) => /^\d+$/.test(id))).toBe(false);
  });
});
