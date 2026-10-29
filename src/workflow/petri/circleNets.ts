import circleNetsYaml from '../../../workflow/nets/circle-test.nets.yaml?raw';
import { loadSubNets } from './subnet';

/** The circle test branch: Home (1) → circle test (2) → edge points (3) → add / pop-up / fit (4) → retake (5). */
export const circleNets = loadSubNets(circleNetsYaml);
