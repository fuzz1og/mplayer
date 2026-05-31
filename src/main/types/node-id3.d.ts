declare module 'node-id3' {
  interface ImageTag {
    mime: string;
    type: { id: number };
    description: string;
    imageBuffer: Buffer;
  }

  interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    trackNumber?: string;
    year?: string;
    genre?: string;
    performerInfo?: string;
    composer?: string;
    image?: ImageTag;
    [key: string]: unknown;
  }

  interface Options {
    include?: string[];
    exclude?: string[];
    onlyRaw?: boolean;
    noRaw?: boolean;
  }

  export function write(tags: Tags, filepath: string): boolean | Error;
  export function write(tags: Tags, buffer: Buffer): Buffer;
  export function write(tags: Tags, filepath: string, fn: (err: Error | null) => void): void;
  export function write(tags: Tags, buffer: Buffer, fn: (err: Error | null, buffer: Buffer) => void): void;

  export function read(filepath: string, options?: Options): Tags;
  export function read(buffer: Buffer, options?: Options): Tags;
  export function read(filepath: string, fn: (err: Error | null, tags: Tags) => void): void;
  export function read(buffer: Buffer, fn: (err: Error | null, tags: Tags) => void): void;

  export function update(tags: Tags, filepath: string, options?: Options): boolean | Error;
  export function update(tags: Tags, buffer: Buffer, options?: Options): Buffer;

  export function create(tags: Tags): Buffer;

  export function removeTags(filepath: string): boolean | Error;
  export function removeTagsFromBuffer(buffer: Buffer): Buffer;

  export const Promise: {
    write(tags: Tags, filepath: string | Buffer): Promise<boolean | Buffer>;
    read(filepath: string | Buffer): Promise<Tags>;
    update(tags: Tags, filepath: string | Buffer, options?: Options): Promise<boolean | Buffer>;
    create(tags: Tags): Promise<Buffer>;
    removeTags(filepath: string): Promise<boolean | Error>;
  };
}
