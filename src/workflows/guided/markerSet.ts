/**
 * This garden's marker set: survey point → sleeve ID, as assigned in the print-fit-markers step
 * (see definitions.ts). The whole-photo scan only accepts these IDs (docs/marker-detection.md).
 * There is no model field for the assignment yet; when there is, read it from the garden instead.
 */
export const GARDEN_MARKERS: Readonly<Record<string, string>> = {
  BAS01: '315',
  BAS02: '36E',
  CRC01: '459',
  CRC02: '6BA',
  CRC03: '8A3',
  CRC04: '952',
  CRC05: 'DAC',
  CRC06: 'EC5',
};

export const GARDEN_MARKER_IDS: string[] = Object.values(GARDEN_MARKERS);

/** Point name for a sleeve ID, if it is one of ours. */
export function pointForMarkerId(id: string): string | undefined {
  const want = id.trim().toUpperCase();
  return Object.keys(GARDEN_MARKERS).find((p) => GARDEN_MARKERS[p] === want);
}
