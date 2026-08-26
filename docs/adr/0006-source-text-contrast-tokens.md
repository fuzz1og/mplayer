# 源色/语义色文字变体纪律（彩色文字必须达标 WCAG AA）

来源徽章（SourceBadge badge 形态）用源品牌色原文案当 11px 文字色，QQ 绿/酷狗橙/酷我橙在浅色底 ≈2.1–2.9:1，不达 4.5:1；`colors.success`/`colors.warning` 当正文色同病（settings「直连可用」≈2.3:1）。决定：为每个音乐源配双主题文字变体 `sourceTextColors`（浅色加深、深色提亮），`successText`/`warningText` 推广 `dangerText` 先例，立纪律「语义色/源色当文字一律走 \*Text 变体」。圆点徽章保持品牌色原文案（色块无对比度要求）。

**Status**: accepted

**Considered Options**: 徽章文字改中性色 + 彩底（被否：源色纪律的核心是「源身份可识别」，中性文字会丢源色识别）；保留原文案（被否：对比度债）。

**Consequences**: `ThemeColors` 与 `sourceColors` token 契约扩展；所有现有「彩色文字」引用点（SourceBadge、settings modeStatusReady、SourceSwapModal 的 success 标记、settings updateAvailableText）统一迁移；代码评审以「文字色是否走变体」为检查项。
