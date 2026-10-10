/*
 * Her own voice, one recording per knowledge-base answer.
 *
 * She reads the law from a fixed list of answers, so every one of them could be
 * read aloud by a person once and played ever after. What a model says cannot
 * be, and falls back to the browser's own voice.
 *
 * WRITTEN BY tools/build-voice.py — do not edit.
 */

export interface Clip {
  /** The recording's name, which is also its number: /voice/<file>.m4a. */
  file: string;
  /** Its real length, which paces her mouth before the file has loaded. */
  seconds: number;
}

export const CLIPS: Readonly<Record<string, Clip>> = {
  'annual': { file: 'ar-001', seconds: 52.60 },
  'annual-first-year': { file: 'ar-002', seconds: 11.40 },
  'annual-hazard': { file: 'ar-003', seconds: 17.60 },
  'annual-rules': { file: 'ar-004', seconds: 23.40 },
  'annual-written-refusal': { file: 'ar-005', seconds: 17.20 },
  'annual-no-split': { file: 'ar-006', seconds: 11.50 },
  'exam': { file: 'ar-007', seconds: 25.20 },
  'newborn-day': { file: 'ar-008', seconds: 13.70 },
  'casual': { file: 'ar-009', seconds: 14.70 },
  'holidays-list': { file: 'ar-010', seconds: 71.90 },
  'work-on-holiday': { file: 'ar-011', seconds: 27.90 },
  'hajj': { file: 'ar-012', seconds: 18.50 },
  'sick-industrial': { file: 'ar-013', seconds: 38.60 },
  'sick-general': { file: 'ar-014', seconds: 28.10 },
  'sick-to-annual': { file: 'ar-015', seconds: 12.20 },
  'contact-infectious': { file: 'ar-016', seconds: 19.60 },
  'pregnant-hours': { file: 'ar-017', seconds: 14.50 },
  'return-after-maternity': { file: 'ar-018', seconds: 15.10 },
  'maternity': { file: 'ar-019', seconds: 18.10 },
  'nursing': { file: 'ar-020', seconds: 17.70 },
  'childcare': { file: 'ar-021', seconds: 22.60 },
  'unpaid': { file: 'ar-022', seconds: 19.50 },
  'other-work': { file: 'ar-023', seconds: 12.70 },
  'who': { file: 'ar-024', seconds: 12.60 },
  'greeting': { file: 'ar-025', seconds: 10.70 },
  'thanks': { file: 'ar-026', seconds: 4.20 },
  'disclaimer': { file: 'ar-027', seconds: 16.10 },
  'fallback': { file: 'ar-028', seconds: 13.50 },
};

/** Where the recording of an answer lives, or null when that answer has none. */
export function clipFor(id: string | undefined): { src: string; seconds: number } | null {
  const clip = id ? CLIPS[id] : undefined;
  return clip ? { src: `/voice/${clip.file}.m4a`, seconds: clip.seconds } : null;
}
