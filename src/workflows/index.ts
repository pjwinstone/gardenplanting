/** Workflows — scripts that call the toolbox; coach prompts stay in coach.ts. */

export { startStage2FieldWorkflow, type Stage2StartResult } from './stage2Field';
export {
  loadSyntheticWorkflow,
  runMilestoneDemoWorkflow,
  type MilestoneResult,
} from './milestone';
export {
  beginEstablishBaselineWorkflow,
  saveBaselineLengthWorkflow,
  type EstablishBaselineResult,
} from './establishBaseline';
export {
  beginMeasureHouseWorkflow,
  addHouseCornerWorkflow,
  closeHouseWorkflow,
} from './measureHouse';
export { workflowAddPoint } from './addPoint';
