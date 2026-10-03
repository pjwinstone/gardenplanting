declare module 'exifr/dist/lite.esm.mjs' {
  export function parse(
    data: unknown,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined>;
}
