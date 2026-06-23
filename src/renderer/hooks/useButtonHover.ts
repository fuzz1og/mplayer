import { useCallback, MouseEventHandler } from 'react';

type ButtonHoverConfig = {
  hoverBg?: string;
  hoverColor?: string;
  leaveBg?: string;
  leaveColor?: string;
};

export const useButtonHover = (config: ButtonHoverConfig = {}) => {
  const { hoverBg = 'var(--hover-bg)', hoverColor, leaveBg = 'transparent', leaveColor } = config;

  const handleMouseEnter: MouseEventHandler<HTMLElement> = useCallback((e) => {
    if (hoverColor) {
      e.currentTarget.style.color = hoverColor;
    }
    if (hoverBg) {
      e.currentTarget.style.backgroundColor = hoverBg;
    }
  }, [hoverBg, hoverColor]);

  const handleMouseLeave: MouseEventHandler<HTMLElement> = useCallback((e) => {
    if (leaveColor) {
      e.currentTarget.style.color = leaveColor;
    }
    e.currentTarget.style.backgroundColor = leaveBg;
  }, [leaveBg, leaveColor]);

  return { handleMouseEnter, handleMouseLeave };
};