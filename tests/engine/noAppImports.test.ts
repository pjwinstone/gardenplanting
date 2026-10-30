import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('src/engine is generic', () => {
  it('imports only itself and the yaml parser', () => {
    const dir = join(__dirname, '../../src/engine');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (!(spec.startsWith('./') && !spec.includes('..')) && spec !== 'yaml') bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
