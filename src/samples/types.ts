/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Sample Library metadata (WO-3E-09)

   A sample is a dataset plus what a reader needs to know before analysing it:
   which columns are factors, which are responses, what units they carry, and
   whether the data are measured or synthetic. The tutorial system links to
   these entries by id only — no sample data is copied into a tutorial.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../types';
import type { LocalizedText } from '../lib/localized';

export type SampleCategory = 'process' | 'comparison' | 'regression' | 'doe' | 'msa' | 'reliability' | 'display-optics';

export type SampleVariableRole = 'id' | 'pttype' | 'factor' | 'response' | 'group' | 'time' | 'censor' | 'reference';

export interface SampleVariable {
  name: string;
  role: SampleVariableRole;
  unit?: string;
  note?: LocalizedText;
}

export interface SampleDef {
  id: string;
  /** Interface key for menus that listed the seven original datasets. */
  nameKey: string;
  title: LocalizedText;
  summary: LocalizedText;
  category: SampleCategory;
  /** true when the rows were generated rather than measured. */
  synthetic: boolean;
  source: LocalizedText;
  variables: SampleVariable[];
  build: () => Worksheet;
  /** Textbook order in the library (smallest first). */
  tutorialIds: string[];
  helpIds: string[];
}

/** The shape the existing menu code already consumes. */
export interface DatasetDef {
  id: string;
  nameKey: string;
  build: () => Worksheet;
}
