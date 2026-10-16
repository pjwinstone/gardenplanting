export type TransitionKind = 'user' | 'app';

export interface PetriPlace {
  id: string;
  label?: string;
}

export interface PetriTransition {
  id: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  kind: TransitionKind;
  label: string;
  /** Prose guard from YAML (documentation); runtime uses transition id in guards.ts */
  guardNote?: string;
  does?: string;
}

export interface PetriNetDoc {
  id: string;
  title: string;
  revision: number;
  places: PetriPlace[];
  initial: Record<string, number>;
  transitions: PetriTransition[];
}

export type Marking = Record<string, number>;

export interface ObservationLogEntry {
  seq: number;
  transitionId: string;
  at: string;
  kind: TransitionKind;
}

export interface PetriRunState {
  activity: string;
  version: number;
  marking: Marking;
  log: ObservationLogEntry[];
  context: Record<string, unknown>;
}
