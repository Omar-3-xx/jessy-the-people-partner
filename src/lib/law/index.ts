import records from './law-data.json';
import vectors from './law-vectors.json';
import { buildIndex, type LawIndex, type LawRecord, type LawVectors } from './search.ts';

export const LAW = records as LawRecord[];

let built: LawIndex | null = null;

/** Built on the first question a Worker sees and kept for the ones after it. */
export function lawIndex(): LawIndex {
  built ??= buildIndex(LAW, vectors as LawVectors);
  return built;
}
