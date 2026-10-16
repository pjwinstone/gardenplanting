export type TransitionKind = 'user' | 'app';

export interface PetriPlace {
  id: string;
}

export interface PetriTransition {
  id: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  kind: TransitionKind;
  screen: string;
  label: string;
  guard?: string;
  glossary?: string[];
}

export interface PetriNetDoc {
  activity: string;
  version: number;
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
