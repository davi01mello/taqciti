import { describe, expect, it } from 'vitest';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Escopo } from './contratos';
import { conferirEnvio } from './verificacaoDeEnvio';
import { revisarDocumento } from './revisao';

const escopo: Escopo = {
  reunioes: ['m1'],
  documentos: 'vinculados',
  conversaId: 'c1',
  efeitos: ['leitura'],
};

const reuniao = (id: string, falas = 1): MeetingRecord =>
  ({
    id,
    title: `Reunião ${id}`,
    startedAt: 0,
    endedAt: 1,
    durationSeconds: 1,
    participants: [],
    segments: Array.from({ length: falas }, (_, i) => ({
      captionId: `${i}`,
      speaker: 'Ana',
      text: 'texto',
      startOffsetMs: i * 1000,
    })),
    status: 'ready',
    metadata: {},
  }) as unknown as MeetingRecord;

const doc = (p: Partial<DocumentoGuardado> & { id: string }): DocumentoGuardado => ({
  title: `Doc ${p.id}`,
  content: '# Doc\n\ntexto',
  formato: 'markdown',
  createdAt: 1,
  updatedAt: 1,
  origem: 'gerado',
  ...p,
});

const base = {
  escopo,
  documentos: [doc({ id: 'd1', meetingId: 'm1' }), doc({ id: 'd2', meetingId: 'm9' })],
  reunioes: [reuniao('m1'), reuniao('m9'), reuniao('mv', 0)],
};

describe('conferirEnvio', () => {
  it('envio correto passa, sem problema', () => {
    const r = conferirEnvio({
      ...base,
      destinatarios: [{ nome: 'Bia', email: 'bia@citi.org.br' }],
      anexos: [{ tipo: 'documento', id: 'd1' }],
      enderecosAutorizados: ['Bia@citi.org.br'],
      dominioDaOrganizacao: 'citi.org.br',
    });
    expect(r).toEqual({ ok: true, problemas: [] });
  });

  it('sem destinatário e sem anexo bloqueia', () => {
    const r = conferirEnvio({ ...base, destinatarios: [], anexos: [] });
    expect(r.ok).toBe(false);
    expect(r.problemas.map((p) => p.codigo)).toEqual(['sem_destinatario', 'sem_anexo']);
  });

  it('endereço inválido bloqueia; repetido só avisa', () => {
    const r = conferirEnvio({
      ...base,
      destinatarios: [{ email: 'bia@' }, { email: 'a@citi.org.br' }, { email: 'A@citi.org.br' }],
      anexos: [{ tipo: 'documento', id: 'd1' }],
    });
    expect(r.ok).toBe(false);
    expect(r.problemas.find((p) => p.codigo === 'endereco_invalido')?.bloqueia).toBe(true);
    expect(r.problemas.find((p) => p.codigo === 'endereco_repetido')?.bloqueia).toBe(false);
  });

  it('endereço que a pessoa não escreveu nem escolheu não passa (nada de adivinhar)', () => {
    const r = conferirEnvio({
      ...base,
      destinatarios: [{ nome: 'Carla', email: 'carla@citi.org.br' }],
      anexos: [{ tipo: 'documento', id: 'd1' }],
      enderecosAutorizados: ['bia@citi.org.br'],
    });
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toMatchObject({ codigo: 'endereco_nao_autorizado', bloqueia: true });
  });

  it('de fora da organização: avisa, sem bloquear', () => {
    const r = conferirEnvio({
      ...base,
      destinatarios: [{ email: 'x@outra.com' }],
      anexos: [{ tipo: 'documento', id: 'd1' }],
      dominioDaOrganizacao: '@citi.org.br',
    });
    expect(r.ok).toBe(true);
    expect(r.problemas).toEqual([expect.objectContaining({ codigo: 'fora_da_organizacao', bloqueia: false })]);
  });

  it('anexo inexistente, fora do escopo e vazio bloqueiam', () => {
    const r = conferirEnvio({
      ...base,
      destinatarios: [{ email: 'a@citi.org.br' }],
      anexos: [
        { tipo: 'documento', id: 'nao-existe' },
        { tipo: 'documento', id: 'd2' }, // reunião m9 está fora do escopo
        { tipo: 'transcricao', id: 'm9' }, // idem
        { tipo: 'transcricao', id: 'm1' }, // ok
      ],
    });
    expect(r.problemas.map((p) => p.codigo)).toEqual([
      'anexo_inexistente',
      'anexo_fora_do_escopo',
      'anexo_fora_do_escopo',
    ]);
    expect(r.ok).toBe(false);

    const vazia = conferirEnvio({
      ...base,
      escopo: { ...escopo, reunioes: 'todas' },
      destinatarios: [{ email: 'a@citi.org.br' }],
      anexos: [{ tipo: 'transcricao', id: 'mv' }],
    });
    expect(vazia.problemas[0]).toMatchObject({ codigo: 'anexo_vazio', bloqueia: true });
  });
});

describe('revisarDocumento — campo indispensável e vínculo', () => {
  const ata = (content: string, meetingId?: string) =>
    doc({ id: 'a', tipo: 'Ata de Reunião', content, ...(meetingId ? { meetingId } : {}) });

  it('Ata sem projeto (indispensável) é problema alto', () => {
    const r = revisarDocumento(ata('# Ata\n\n## Identificação\n\n**Projeto:** A confirmar\n'), []);
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ tipo: 'campo_indispensavel', gravidade: 'alta' }),
    );
  });

  it('Ata com projeto preenchido não aponta o campo', () => {
    const r = revisarDocumento(ata('# Ata\n\n## Identificação\n\n**Projeto:** Orbital\n'), []);
    expect(r.problemas.find((p) => p.tipo === 'campo_indispensavel')).toBeUndefined();
  });

  it('reunião de origem que sumiu vira vínculo quebrado', () => {
    const r = revisarDocumento(ata('# Ata\n', 'm-apagada'), [reuniao('m1')]);
    expect(r.problemas.map((p) => p.tipo)).toContain('vinculo_quebrado');
  });
});
