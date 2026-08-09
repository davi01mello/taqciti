/**
 * Mapa documentType → DocumentTemplate. Ponte principal do chunking: cada
 * tipo tem seções conhecidas (SectionSpec) em vez de prosa embutida no
 * gerador — ver types.ts pro formato e cada arquivo de tipo pra origem do
 * `guidance` extraído.
 */
import type { DocumentType } from '../documentTypes';
import type { DocumentTemplate } from './types';
import { ata } from './ata';
import { x1 } from './x1';
import { daily } from './daily';
import { planning } from './planning';
import { review } from './review';

export type { SectionSpec, DocumentTemplate } from './types';

export const TEMPLATES: Record<DocumentType, DocumentTemplate> = {
  ata,
  x1,
  daily,
  planning,
  review,
};
