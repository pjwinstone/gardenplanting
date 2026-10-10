/** Guided-workflow data. The UI reads this. It does not switch on a workflow id. */

import type { GeometryType } from '../../model';

export type WorkflowId =
  | 'circle-field-test'
  | 'print-fit-markers'
  | 'house-traverse'
  | 'ios-setup';

export type WorkflowStatus = 'ready' | 'later';

export type WorkflowDiagram = 'circle-plan' | 'stn01' | 'sleeve-join';

/** Where a step sends the surveyor. Only screens the app already has. */
export type WorkflowLink =
  | { to: 'none' }
  | { to: 'mode'; mode: 'BASELINE' | 'ADD_POINT' }
  | { to: 'menu'; section: 'baseline' | 'cloud' | 'tools' }
  | { to: 'print-tags' }
  | { to: 'marker-pdf'; file: string };

export type WorkflowTrigger =
  | { on: 'manual' }
  | {
      on: 'baseline.saved';
      endA: string;
      endB: string;
      kind: 'tape' | 'laser';
      /** When set, the saved offsets must match (millimetres). */
      offsetAMm?: number;
      offsetBMm?: number;
    }
  | { on: 'photo.verified'; stationId: string; minPhotos: number }
  | { on: 'photo.marksConfirmed'; stationId: string; marks: string[] }
  | { on: 'item.created'; name: string; geometry: GeometryType }
  | { on: 'tape.entered'; endA?: string; endB?: string }
  | { on: 'cloud.saved' }
  | { all: WorkflowTrigger[] };

/** Facts the app already records. A step ticks when its trigger matches. */
export type WorkflowEvent =
  | {
      type: 'baseline.saved';
      /** What was typed in End A / End B. */
      endA: string;
      endB: string;
      /** Point ids the document stored, when they differ from the typed names. */
      endAId?: string;
      endBId?: string;
      kind: 'tape' | 'laser';
      offsetAMm: number;
      offsetBMm: number;
      lengthM: number;
    }
  | {
      type: 'photo.verified';
      stationId: string;
      pointLabel: string;
      objectName: string;
      /** Verified, usable photos on that station. */
      photoCount: number;
    }
  | {
      type: 'photo.marksConfirmed';
      stationId: string;
      pointLabel: string;
      objectName: string;
      marks: string[];
    }
  | { type: 'item.created'; name: string; geometry: string }
  | {
      type: 'tape.entered';
      endA: string;
      endB: string;
      endAId?: string;
      endBId?: string;
      lengthM: number;
    }
  | { type: 'cloud.saved' }
  | { type: 'manual.tick'; stepId: string; note?: string };

export interface WorkflowStep {
  id: string;
  title: string;
  /** One line on the collapsed bar. */
  instruction: string;
  /** Shown in place of the title once this step has ticked, while it is still current. */
  doneTitle?: string;
  doneInstruction?: string;
  /** Expanded sheet. Sentences from the field sheet. */
  detail: string[];
  diagram?: WorkflowDiagram;
  /** Placeholder for the write-in the model does not store yet. */
  noteLabel?: string;
  complete: WorkflowTrigger;
  link: WorkflowLink;
}

export interface WorkflowDefinition {
  id: WorkflowId;
  revision: number;
  status: WorkflowStatus;
  title: string;
  summary: string;
  steps: WorkflowStep[];
}

export interface StepState {
  status: 'pending' | 'complete';
  completedBy: 'manual' | 'auto' | null;
  completedAt?: string;
  /** Sleeve R, two baseline pulls, heights. Not a solver field. */
  note?: string;
  /** Parts of an `all` trigger that have already matched. */
  seen?: string[];
}

export interface WorkflowRun {
  workflowId: WorkflowId;
  revision: number;
  currentStepId: string;
  updatedAt: string;
  finishedAt?: string;
  /** Step ids from an older revision. One line in the sheet, not a solver field. */
  parkedStepIds?: string[];
  steps: Record<string, StepState>;
}

/**
 * Optional field on the garden document. Older readers ignore it.
 * Local ticks and the OneDrive save share this object.
 */
export interface WorkflowProgress {
  version: 1;
  activeId?: WorkflowId;
  runs: Partial<Record<WorkflowId, WorkflowRun>>;
}
