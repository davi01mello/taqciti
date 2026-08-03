import { describe, expect, it } from 'vitest';
import { SpeakerRegistry, identityKey, isPlausibleSpeakerName } from './speakerIdentity';

describe('identityKey', () => {
  it('colapsa caixa, acento e espaço', () => {
    expect(identityKey('BERNARDO  BELFORT')).toBe('bernardo belfort');
    expect(identityKey('Bernardo Belfórt')).toBe('bernardo belfort');
  });

  it('descarta o sufixo de papel que o Meet cola no nome', () => {
    expect(identityKey('Bernardo Belfort (Você)')).toBe('bernardo belfort');
    expect(identityKey('Bernardo Belfort (Apresentando)')).toBe('bernardo belfort');
    expect(identityKey('Ana Souza (host)')).toBe('ana souza');
  });

  it('não apaga um nome que é só o sufixo (melhor nome estranho que nenhum)', () => {
    expect(identityKey('Host')).toBe('host');
  });
});

describe('SpeakerRegistry — a própria pessoa não pode virar duas', () => {
  it('resolve "Você" para o nome real assim que ele aparece', () => {
    const registry = new SpeakerRegistry();
    expect(registry.resolve('Você')).toBe('Você');

    registry.setSelfName('Bernardo Belfort');
    expect(registry.resolve('Você')).toBe('Bernardo Belfort');
    expect(registry.knownNames()).toEqual(['Bernardo Belfort']);
  });

  it('devolve o rename para corrigir a transcrição já capturada', () => {
    const registry = new SpeakerRegistry();
    registry.resolve('Você');
    registry.setSelfName('Bernardo Belfort');

    expect(registry.drainRenames()).toEqual([
      { from: 'Você', to: 'Bernardo Belfort' },
    ]);
    // Drenar zera a fila: o mesmo rename não é aplicado duas vezes.
    expect(registry.drainRenames()).toEqual([]);
  });

  it('trata o nome com sufixo do tile como a mesma pessoa', () => {
    const registry = new SpeakerRegistry();
    registry.setSelfName('Bernardo Belfort');

    expect(registry.resolve('Bernardo Belfort (Você)')).toBe('Bernardo Belfort');
    expect(registry.resolve('bernardo belfort')).toBe('Bernardo Belfort');
    expect(registry.knownNames()).toEqual(['Bernardo Belfort']);
  });

  it('numa reunião só com a própria pessoa, conhece exatamente 1 nome', () => {
    const registry = new SpeakerRegistry();
    registry.resolve('Você');
    registry.resolve('Você');
    registry.setSelfName('Bernardo Belfort');
    registry.resolve('Você');
    registry.resolve('Bernardo Belfort (Apresentando)');

    expect(registry.knownNames()).toHaveLength(1);
    expect(registry.isSelf('Bernardo Belfort')).toBe(true);
  });
});

describe('SpeakerRegistry — variantes de nome de outras pessoas', () => {
  it('não funde nome curto no completo sem um sinal adicional', () => {
    const registry = new SpeakerRegistry();
    expect(registry.resolve('Ana')).toBe('Ana');
    expect(registry.resolve('Ana Souza')).toBe('Ana Souza');

    expect(registry.knownNames()).toEqual(['Ana', 'Ana Souza']);
    expect(registry.drainRenames()).toEqual([]);
  });

  it('mantém a versão curta separada mesmo depois do nome completo', () => {
    const registry = new SpeakerRegistry();
    registry.resolve('Ana Souza');
    expect(registry.resolve('Ana')).toBe('Ana');
    expect(registry.knownNames()).toEqual(['Ana Souza', 'Ana']);
  });

  it('funde grafias quando o mesmo tile estável fornece o sinal', () => {
    const registry = new SpeakerRegistry();
    expect(registry.observeParticipant('Ana', 'tile-17')).toBe('Ana');
    expect(registry.observeParticipant('Ana Souza', 'tile-17')).toBe('Ana Souza');
    expect(registry.knownNames()).toEqual(['Ana Souza']);
    expect(registry.drainRenames()).toEqual([{ from: 'Ana', to: 'Ana Souza' }]);
  });

  it('não mistura duas pessoas com o mesmo primeiro nome', () => {
    const registry = new SpeakerRegistry();
    registry.observeParticipant('Ana Souza', 'tile-a');
    registry.observeParticipant('Ana Lima', 'tile-b');
    registry.resolve('Ana');
    expect(registry.knownNames()).toEqual(['Ana Souza', 'Ana Lima', 'Ana']);
  });

  it('mantém pessoas diferentes separadas', () => {
    const registry = new SpeakerRegistry();
    registry.setSelfName('Bernardo Belfort');
    registry.resolve('Você');
    registry.resolve('Ana Souza');
    registry.resolve('Carlos Lima');

    expect(registry.knownNames()).toEqual([
      'Bernardo Belfort',
      'Ana Souza',
      'Carlos Lima',
    ]);
  });

  it('ignora rótulo vazio ou sem letra nenhuma', () => {
    const registry = new SpeakerRegistry();
    expect(registry.resolve(null)).toBeNull();
    expect(registry.resolve('   ')).toBeNull();
    expect(registry.resolve('!!!')).toBeNull();
  });
});

describe('SpeakerRegistry — rejeição de chrome e falsos nomes', () => {
  it('rejeita timestamps, contagens, status, botões e frases longas', () => {
    for (const candidate of [
      '14:32',
      '12 participantes',
      'Microfone desativado',
      'Ir até o fim',
      'Esta é uma frase longa que claramente não representa o nome de uma pessoa',
    ]) {
      expect(isPlausibleSpeakerName(candidate)).toBe(false);
    }
  });

  it('aceita nomes, self e conta sem nome exibida como e-mail', () => {
    expect(isPlausibleSpeakerName('Ana-Maria de Souza')).toBe(true);
    expect(isPlausibleSpeakerName('You')).toBe(true);
    expect(isPlausibleSpeakerName('conta.pessoal@gmail.com')).toBe(true);
  });

  it('reset impede que uma sala diferente herde identidades', () => {
    const registry = new SpeakerRegistry();
    registry.resolve('Ana Souza');
    registry.reset();
    expect(registry.knownNames()).toEqual([]);
  });
});

describe('SpeakerRegistry — encadeamento de renames', () => {
  it('encurta a corrente para o destino final', () => {
    const registry = new SpeakerRegistry();
    registry.resolve('Você');
    registry.setSelfName('Bernardo');
    registry.setSelfName('Bernardo Belfort');

    const renames = registry.drainRenames();
    // "Você" precisa terminar no nome final, não no intermediário.
    expect(renames).toContainEqual({ from: 'Você', to: 'Bernardo Belfort' });
    expect(renames.every((entry) => entry.to === 'Bernardo Belfort')).toBe(true);
  });
});
