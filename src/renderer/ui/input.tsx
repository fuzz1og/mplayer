import React from 'react';
import './ui.css';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** 单行输入框：受控/非受控都走原生 input 语义。 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={className ? `ui-input ${className}` : 'ui-input'} {...rest} />;
});
