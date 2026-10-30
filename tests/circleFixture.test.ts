import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { circleResultDetailForRun } from '../src/workflows/guided/circleResult';
import { readProgress } from '../src/workflows/guided/engine';
import { buildCircleDoc } from './fixtures/circleDoc';

describe('circle fixture', () => {
  it('solves', () => {
    const d = buildCircleDoc(5);
    const det = circleResultDetailForRun(d, readProgress(d).runs['circle-field-test']!);
    console.log(det.verdict.state, det.verdict.headline, det.gates.map((g) => g.pointId + ':' + g.cls).join(' '));
    expect(det.gates.length).toBe(5);
    if (process.env.WRITE_FIXTURE) {
      for (const n of [0, 1, 3, 8, 12]) writeFileSync(`${process.env.WRITE_FIXTURE}/circle-${n}.json`, JSON.stringify(buildCircleDoc(n)));
    }
  });
});
