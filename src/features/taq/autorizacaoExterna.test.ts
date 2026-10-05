/**
 * Quando uma ação externa sai direto e quando passa por prévia — funções puras.
 */
import { describe, expect, it } from 'vitest';
import {
  corpoNoPedido,
  decidirAlteracaoDeEvento,
  decidirEnvio,
  decidirEvento,
  horarioNoPedido,
  nomeNoPedido,
  tituloNoPedido,
} from './autorizacaoExterna';
import { confirmaAcaoExterna, efeitosDoPedido, pedeAcaoExterna, pedeRepeticao } from './politica';

const ana = { citadaNoPedido: true, daOrganizacao: true };

describe('quem pediu o quê', () => {
  it('nome no pedido: todas as partes, como palavras', () => {
    expect(nomeNoPedido('Ana Souza', 'envie a ata para Ana Souza')).toBe(true);
    expect(nomeNoPedido('Ana Souza', 'envie a ata para Ana')).toBe(false);
    expect(nomeNoPedido('Ana', 'envie a ata para Banana')).toBe(false);
  });

  it('horário no pedido: "às 14h", "14:30"; "amanhã" sozinho não vale', () => {
    expect(horarioNoPedido('marque uma call amanhã às 14h')).toBe(true);
    expect(horarioNoPedido('marque às 14:30')).toBe(true);
    expect(horarioNoPedido('marque uma call amanhã')).toBe(false);
  });

  it('corpo entre aspas no pedido, e título do evento', () => {
    expect(corpoNoPedido('Reunião adiada para sexta', 'mande "Reunião adiada para sexta" para a Ana')).toBe(true);
    expect(corpoNoPedido('Resumo longo escrito pelo modelo', 'mande um resumo para a Ana')).toBe(false);
    expect(tituloNoPedido('Alinhamento de escopo', 'cancele o alinhamento de escopo')).toBe(true);
    expect(tituloNoPedido('Alinhamento de escopo', 'cancele aquele evento')).toBe(false);
  });
});

describe('o pedido autoriza uma ação externa? (a frase da pessoa, nunca a transcrição)', () => {
  it('envio e agenda pedidos pela pessoa', () => {
    expect(pedeAcaoExterna('Gere a ata desta reunião e envie para a Ana')).toBe(true);
    expect(pedeAcaoExterna('mande a transcrição por e-mail para o Bruno')).toBe(true);
    expect(pedeAcaoExterna('marque uma reunião amanhã às 14h com a Ana')).toBe(true);
    expect(pedeAcaoExterna('cancele o evento de sexta')).toBe(true);
    expect(pedeAcaoExterna('crie um evento para a retro')).toBe(true);
  });

  it('o que não é pedido de saída não concede o efeito', () => {
    expect(pedeAcaoExterna('o que decidimos na reunião?')).toBe(false);
    expect(pedeAcaoExterna('resuma a ata')).toBe(false);
    expect(pedeAcaoExterna('crie a ata da reunião')).toBe(false);
    expect(efeitosDoPedido('o que decidimos na reunião?')).not.toContain('acao_externa');
    expect(efeitosDoPedido('envie a ata para a Ana')).toContain('acao_externa');
  });

  it('escolher entre pessoas parecidas continua o pedido e mantém o efeito', () => {
    expect(efeitosDoPedido('Ana Souza', 'escolha_de_registro')).toContain('acao_externa');
    expect(efeitosDoPedido('Ana Souza')).not.toContain('acao_externa');
  });

  it('confirmação e pedido de repetição', () => {
    expect(confirmaAcaoExterna('pode enviar')).toBe(true);
    expect(confirmaAcaoExterna('envie')).toBe(true);
    expect(confirmaAcaoExterna('hmm, talvez')).toBe(false);
    expect(pedeRepeticao('reenvie mesmo assim')).toBe(true);
    expect(pedeRepeticao('envie a ata para a Ana')).toBe(false);
  });
});

describe('e-mail: direto ou com prévia', () => {
  const direto = { pedido: 'envie a ata para a Ana', destinatarios: [ana], temAnexo: true, corpo: 'Segue a ata.', alertas: 0 };

  it('destinatário dito, anexo escolhido, texto curto: sai direto', () => {
    expect(decidirEnvio(direto)).toEqual({ direto: true, motivos: [] });
  });

  it('destinatário que a pessoa não disse: prévia', () => {
    const r = decidirEnvio({ ...direto, destinatarios: [{ ...ana, citadaNoPedido: false }] });
    expect(r.direto).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/não foi dito por você/);
  });

  it('de fora da organização, dado sensível, ou texto composto pelo Taq: prévia', () => {
    expect(decidirEnvio({ ...direto, destinatarios: [{ ...ana, daOrganizacao: false }] }).direto).toBe(false);
    expect(decidirEnvio({ ...direto, alertas: 1 }).direto).toBe(false);
    const composto = decidirEnvio({ ...direto, temAnexo: false, corpo: 'Um resumo que o Taq escreveu sozinho.' });
    expect(composto.direto).toBe(false);
    expect(composto.motivos.join(' ')).toMatch(/composto pelo Taq/);
  });

  it('sem anexo, mas a pessoa ditou o texto entre aspas: sai direto', () => {
    expect(
      decidirEnvio({
        pedido: 'mande "Reunião adiada para sexta" para a Ana',
        destinatarios: [ana],
        temAnexo: false,
        corpo: 'Reunião adiada para sexta',
        alertas: 0,
      }).direto,
    ).toBe(true);
  });

  it('ninguém como destinatário: nunca direto', () => {
    expect(decidirEnvio({ ...direto, destinatarios: [] }).direto).toBe(false);
  });
});

describe('agenda: direto ou com prévia', () => {
  it('horário e convidados ditos: direto; horário só deduzido: prévia', () => {
    expect(decidirEvento({ pedido: 'marque a retro amanhã às 14h com a Ana', participantes: [ana] }).direto).toBe(true);
    expect(decidirEvento({ pedido: 'marque a retro amanhã com a Ana', participantes: [ana] }).direto).toBe(false);
  });

  it('convidado de fora: prévia', () => {
    expect(
      decidirEvento({ pedido: 'marque às 14h com x@fora.com', participantes: [{ citadaNoPedido: true, daOrganizacao: false }] })
        .direto,
    ).toBe(false);
  });

  it('remarcar exige o evento e o horário no pedido; cancelar com convidados exige dizer cancelar', () => {
    const base = { titulo: 'Alinhamento de escopo', temConvidados: true };
    expect(
      decidirAlteracaoDeEvento({ ...base, pedido: 'remarque o alinhamento de escopo para sexta às 10h', exigeHorario: true }).direto,
    ).toBe(true);
    expect(decidirAlteracaoDeEvento({ ...base, pedido: 'remarque o evento para sexta', exigeHorario: true }).direto).toBe(false);
    expect(decidirAlteracaoDeEvento({ ...base, pedido: 'o alinhamento de escopo', exigeHorario: false }).direto).toBe(false);
  });
});
