import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import LinkImportForm from '../components/LinkImportForm';

describe('LinkImportForm', () => {
  const defaultProps = {
    linkUrl: '',
    onLinkUrlChange: vi.fn(),
    onParse: vi.fn(),
    loading: false,
    error: null
  };

  it('should render link input', () => {
    render(<LinkImportForm {...defaultProps} />);
    expect(screen.getByPlaceholderText('请输入网易云歌单链接')).toBeInTheDocument();
  });

  it('should render parse button', () => {
    render(<LinkImportForm {...defaultProps} />);
    expect(screen.getByText('解析链接')).toBeInTheDocument();
  });

  it('should call onLinkUrlChange when input changes', () => {
    const onLinkUrlChange = vi.fn();
    render(<LinkImportForm {...defaultProps} onLinkUrlChange={onLinkUrlChange} />);

    const input = screen.getByPlaceholderText('请输入网易云歌单链接');
    fireEvent.change(input, { target: { value: 'https://music.163.com/#/playlist?id=123' } });

    expect(onLinkUrlChange).toHaveBeenCalledWith('https://music.163.com/#/playlist?id=123');
  });

  it('should call onParse when parse button is clicked', () => {
    const onParse = vi.fn();
    render(<LinkImportForm {...defaultProps} linkUrl="https://music.163.com/#/playlist?id=123" onParse={onParse} />);

    fireEvent.click(screen.getByText('解析链接'));

    expect(onParse).toHaveBeenCalled();
  });

  it('should disable button when loading', () => {
    render(<LinkImportForm {...defaultProps} loading={true} />);

    const button = screen.getByRole('button', { name: /解析中/i });
    expect(button).toBeDisabled();
  });

  it('should show error message', () => {
    const error = '无效的链接格式';
    render(<LinkImportForm {...defaultProps} error={error} />);

    expect(screen.getByText(error)).toBeInTheDocument();
  });

  it('should show link format instructions', () => {
    render(<LinkImportForm {...defaultProps} />);

    expect(screen.getByText('支持的格式：')).toBeInTheDocument();
    expect(screen.getAllByText(/music\.163\.com/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/163cn\.tv/)).toBeInTheDocument();
  });
});
