/** Markdown reference emitted from the workflow definitions. No dates, so the diff stays quiet. */

import { GUIDED_WORKFLOWS } from './definitions';
import type { WorkflowDefinition, WorkflowLink, WorkflowTrigger } from './types';

function triggerText(trigger: WorkflowTrigger): string {
  if ('all' in trigger) return trigger.all.map(triggerText).join('; and ');
  switch (trigger.on) {
    case 'manual':
      return 'Tick by hand';
    case 'baseline.saved':
      return `baseline.saved ${trigger.kind} ${trigger.endA}–${trigger.endB}, offsets ${trigger.offsetAMm ?? 'any'}/${trigger.offsetBMm ?? 'any'} mm`;
    case 'photo.uploaded':
      return `photo.uploaded ${trigger.stationId}, ${trigger.minPhotos} photo${trigger.minPhotos === 1 ? '' : 's'}`;
    case 'markers.detected':
      return `markers.detected ${trigger.stationId}, ${trigger.minPhotos} photo${trigger.minPhotos === 1 ? '' : 's'}`;
    case 'photo.marksConfirmed':
      return `photo.marksConfirmed ${trigger.stationId} (${trigger.marks.join(', ')})`;
    case 'item.created':
      return `item.created ${trigger.name} ${trigger.geometry}`;
    case 'tape.entered':
      return `tape.entered${trigger.endA ? ` ${trigger.endA}–${trigger.endB ?? ''}` : ''}`;
    case 'cloud.saved':
      return 'cloud.saved';
    default:
      return 'unknown';
  }
}

function linkText(link: WorkflowLink): string {
  if (link.to === 'none') return '—';
  if (link.to === 'mode') return `Mode ${link.mode}`;
  if (link.to === 'menu') return `Menu → ${link.section}`;
  if (link.to === 'print-tags') return 'Print tags';
  return `PDF docs/markers/${link.file}`;
}

function workflowSection(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`## ${workflow.title}`);
  lines.push('');
  lines.push(workflow.status === 'ready' ? `Ready. ${workflow.steps.length} steps.` : 'Coming soon.');
  lines.push('');
  lines.push(workflow.summary);
  lines.push('');
  workflow.steps.forEach((step, index) => {
    lines.push(`### ${index + 1}. ${step.title}`);
    lines.push('');
    lines.push(step.instruction);
    lines.push('');
    for (const line of step.detail) lines.push(`- ${line}`);
    lines.push('');
    lines.push(`Completes when: ${triggerText(step.complete)}.`);
    lines.push('');
    lines.push(`Opens: ${linkText(step.link)}.`);
    if (step.diagram) {
      lines.push('');
      lines.push(`Diagram: ${step.diagram}.`);
    }
    if (step.noteLabel) {
      lines.push('');
      lines.push(`Note: ${step.noteLabel}.`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function generateWorkflowMarkdown(): string {
  const body = GUIDED_WORKFLOWS.map(workflowSection).join('\n');
  return [
    '# Guided workflows',
    '',
    'Generated from `src/workflows/guided/definitions.ts`. Do not edit by hand.',
    'Refresh with `npm run check:workflows -- --write`.',
    '',
    body.trimEnd(),
    '',
  ].join('\n');
}
