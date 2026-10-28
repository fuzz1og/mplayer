import React from 'react';
import './ui.css';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** 单行输入框：受控/非受控都走原生 input 语义。 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={className ? `ui-input ${className}` : 'ui-input'} {...rest} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** 多行输入框：与单行共用同一套表面/边框/焦点语义，只多一个纵向可拉伸。 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={className ? `ui-input ui-textarea ${className}` : 'ui-input ui-textarea'} {...rest} />;
});
