declare module 'pako' {
  const pako: {
    inflate(data: Uint8Array): Uint8Array;
    inflateRaw?(data: Uint8Array): Uint8Array;
  };
  export default pako;
}
