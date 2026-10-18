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
  | { on: 'photo.uploaded'; stationId: string; minPhotos: number }
  /**
   * Reserved for a future in-app detector. Nothing emits this yet.
   * `photo.uploaded` only means the OneDrive upload checked out.
   */
  | { on: 'markers.detected'; stationId: string; minPhotos: number }
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
      type: 'photo.uploaded';
      stationId: string;
      pointLabel: string;
      objectName: string;
      /** Usable photos captured and uploaded after this run started. */
      photoCount: number;
      /** Ids included in photoCount. The step stores these so a later step cannot reuse them. */
      photoIds: string[];
    }
  | {
      type: 'markers.detected';
      stationId: string;
      pointLabel: string;
      objectName: string;
      markerIds: string[];
      photoIds: string[];
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

export type WorkflowStepKind = 'user' | 'app' | 'user+app';

export type StepStatus =
  | 'open'
  | 'waiting_for_app'
  | 'ticked_by_you'
  | 'ticked_by_app'
  | 'ticked_with_reason'
  | 'skipped_with_note'
  | 'evidence_failed'
  | 'needs_recheck'
  /** @deprecated migrated in reconcileRun */
  | 'pending'
  /** @deprecated migrated in reconcileRun */
  | 'complete';

export interface WorkflowStep {
  id: string;
  title: string;
  kind?: WorkflowStepKind;
  n?: number;
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
  status: StepStatus;
  /** Legacy mirror for older tests and saves. */
  completedBy?: 'manual' | 'auto' | null;
  completedAt?: string;
  /** Sleeve R, two baseline pulls, heights. Not a solver field. */
  note?: string;
  /** Parts of an `all` trigger that have already matched. */
  seen?: string[];
  /** Photo ids this step already counted. Not reused by another step in the run. */
  consumedPhotoIds?: string[];
  /** Plain-language reason when evidence_failed or ticked_with_reason. */
  reason?: string;
}

export type SetupStatus = 'unconfirmed' | 'confirmed' | 'changed_mid_run';

export interface FieldTestSetupValues {
  baseline_length_m: number;
  bas02_from_peg_m: number;
  circle_diameter_m: number;
  calibration_distance_m: number;
  camera_positions: {
    left: { to_bas01: number; to_bas02: number };
    right_near: { to_bas01: number; to_bas02: number };
    right_far: { to_bas01: number; to_bas02: number };
  };
  tolerances_mm: {
    baseline: number;
    railway: number;
    flower_bed: number;
    tree: number;
    camera_position: number;
  };
}

export interface WorkflowRunSetup {
  status: SetupStatus;
  values: FieldTestSetupValues;
  confirmedAt?: string;
}

export type RunLogEntry =
  | { at: string; type: 'config.confirmed' }
  | { at: string; type: 'config.changed'; changes: { key: string; from: unknown; to: unknown }[] };

export interface WorkflowRun {
  workflowId: WorkflowId;
  revision: number;
  currentStepId: string;
  /** When this run began. Photos captured or received earlier do not tick a station step. */
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  paused?: boolean;
  setup?: WorkflowRunSetup;
  runLog?: RunLogEntry[];
  /** Step ids from an older revision. One line in the sheet, not a solver field. */
  parkedStepIds?: string[];
  steps: Record<string, StepState>;
}

/**
 * Optional field on the garden document. Older readers ignore it.
 * Local ticks and the OneDrive save share this object.
 */
/** A finished run kept for its notes when the surveyor starts over. */
export interface WorkflowPastRun {
  workflowId: WorkflowId;
  startedAt: string;
  finishedAt?: string;
  archivedAt: string;
  notes: { stepId: string; note: string }[];
}

export interface WorkflowProgress {
  version: 1;
  activeId?: WorkflowId;
  runs: Partial<Record<WorkflowId, WorkflowRun>>;
  /** Earlier runs of any workflow. Sleeve R, heights, and CHK-BASE stay here. */
  pastRuns?: WorkflowPastRun[];
}
