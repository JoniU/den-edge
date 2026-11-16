import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);

describe('TV CI independence', () => {
  it('reports both TV behavior paths before enforcing an executed isolation result', () => {
    const isolation = workflow.indexOf('name: TV isolation and bundle budgets');
    const webos = workflow.indexOf('run: npm run test:e2e:tv\n', isolation);
    const tizen = workflow.indexOf(
      'run: DEN_TV_PLATFORM=tizen npm run test:e2e:tv -- tv-avplay.spec.mjs',
      webos,
    );
    const gate = workflow.indexOf('name: Require TV isolation and bundle budgets', tizen);

    expect(isolation).toBeGreaterThan(-1);
    expect(webos).toBeGreaterThan(isolation);
    expect(tizen).toBeGreaterThan(webos);
    expect(gate).toBeGreaterThan(tizen);

    const isolationStep = workflow.slice(isolation, webos);
    expect(isolationStep).toContain('id: tv_isolation');
    expect(isolationStep).toContain('continue-on-error: true');

    const gateStep = workflow.slice(gate, workflow.indexOf('- name:', gate + 1));
    expect(gateStep).toContain(
      "if: ${{ !cancelled() && steps.tv_isolation.outcome != 'skipped' }}",
    );
    expect(gateStep).toContain('TV_ISOLATION: ${{ steps.tv_isolation.outcome }}');
    expect(gateStep).toContain('test "$TV_ISOLATION" = success');
  });
});
