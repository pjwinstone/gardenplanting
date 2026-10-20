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
  | { to: 'marker-pdf'; file: string }
  /** Straight to the camera for one camera position (roller pill). */
  | { to: 'camera'; stepId: string; cameraPositionId: string };

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

/** One point to tap on a photo after capture. `id` is what is stored; `label` is shown. */
export interface PhotoTapTarget {
  id: string;
  label: string;
  /** Can be passed with "Not in view". Required targets must be tapped before Save. */
  optional?: boolean;
}

/**
 * What the tap screen asks for after a photo on this step. Labels come from here, never from
 * a shared default.
 * - 'sleeve-height': one rough tap on the sleeve (SLEEVE); the app finds the top and bottom edge from the
 *   printed bands (sleeveDetect.ts). Only when it is unsure does it ask for `fallback` (top, then bottom).
 *   Not bearings; the solver ignores them.
 * - 'bearings': named points (BAS01, CRC03 …). Saved as photo clicks; both baseline ends place the camera position.
 */
export interface StepPhotoTaps {
  use: 'sleeve-height' | 'bearings';
  /** One list per photo, in the order taken. A photo past the end uses the last list. */
  photos: PhotoTapTarget[][];
  /** sleeve-height only: manual taps asked for when detection confidence is low. */
  fallback?: PhotoTapTarget[];
}

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
  /** Photo steps only: what to tap on each photo after capture. */
  photoTaps?: StepPhotoTaps;
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
  /** Set by Retake: photos received at or before this time no longer count for the step. */
  retakeAfter?: string;
}

export type SetupStatus = 'unconfirmed' | 'confirmed' | 'changed_mid_run';

import type { FieldTestSetupValues } from './fieldTestMeta';
export type { FieldTestSetupValues };

export interface WorkflowRunSetup {
  status: SetupStatus;
  values: FieldTestSetupValues;
  confirmedAt?: string;
}

export type RunLogEntry =
  | { at: string; type: 'config.confirmed' }
  | { at: string; type: 'config.changed'; changes: { key: string; from: unknown; to: unknown }[] }
  | { at: string; type: 'base-tie.saved'; tie: BaseTie; summary: string }
  | { at: string; type: 'base-tie.removed'; tie: BaseTie };

/**
 * 'Add base points' (rev 6): one tie from a point already placed to another point on the N/E grid.
 * East and North are taped offsets (to − from, m, signed); the diagonal is the taped check.
 * Any reading may be left out on an extra tie. BAS01 is the grid origin.
 */
export interface BaseTie {
  id: string;
  from: string;
  to: string;
  eastM?: number;
  northM?: number;
  diagonalM?: number;
  savedAt: string;
}

export type CircleTapeEdge = 'inside' | 'outside';

/** 'Tape the diameter': three tapes across the circle, about 60° apart, and the edge used. */
export interface CircleTape {
  diametersM: number[];
  edge: CircleTapeEdge;
  savedAt: string;
}

export interface WorkflowRun {
  workflowId: WorkflowId;
  revision: number;
  currentStepId: string;
  /** When this run began. Photos captured or received earlier do not tick a station step. */
  startedAt: string;
  /** Photos superseded by a Retake: still to move to photos/archive/, and what was moved (docs/photo-archive.md). */
  photoArchive?: { pending: import('../../photoArchive').ArchiveJob[]; log: import('../../photoArchive').ArchiveLogEntry[] };
  /** Circle field test: the diameter tapes (docs/garden-circle.md). */
  circleTape?: CircleTape;
  /** Circle field test rev 6: the base-point ties on the N/E grid, in the order they were saved. */
  baseTies?: BaseTie[];
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
