import type { DjRadioProgram } from '../types/index.js';

export interface DjRadioPageFetcher {
  (radioId: string, offset: number, limit: number): Promise<{
    programs: DjRadioProgram[];
    total: number;
    more: boolean;
  }>;
}

/** 双端「播放全部 / 下载全部 / 保存全部」共用：按 200 期串行收齐列表可见节目。 */
export async function fetchAllDjRadioPrograms(
  radioId: string,
  fetchPage: DjRadioPageFetcher,
): Promise<DjRadioProgram[]> {
  const all: DjRadioProgram[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(radioId, offset, 200);
    all.push(...page.programs);
    if (!page.more || page.programs.length === 0) return all;
    offset += page.programs.length;
  }
}
