import { parsePlaylistUrl } from '../services/importService';

describe('parsePlaylistUrl', () => {
  it('should recognize full NetEase playlist URL with hash', () => {
    const url = 'https://music.163.com/#/playlist?id=123456';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease', id: '123456' });
  });

  it('should recognize full URL with query parameters', () => {
    const url = 'https://music.163.com/playlist?id=123456&userid=789';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease', id: '123456' });
  });

  it('should recognize short link with http', () => {
    const url = 'http://163cn.tv/zoIxm3';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease-short', url });
  });

  it('should recognize short link with https', () => {
    const url = 'https://163cn.tv/zoIxm3';
    const result = parsePlaylistUrl(url);
    expect(result).toEqual({ type: 'netease-short', url });
  });

  it('should return null for invalid URL', () => {
    const url = 'https://example.com';
    const result = parsePlaylistUrl(url);
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = parsePlaylistUrl('');
    expect(result).toBeNull();
  });
});
