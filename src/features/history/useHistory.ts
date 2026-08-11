/**
 * Fonte de histórico para as UIs React — leitura pura, sem lógica de negócio.
 * Ações de escrita passam sempre pelo background, nunca por aqui.
 *
 * A normalização de status fica NESTE lado, e não na plataforma, de propósito:
 * ela conserta registros gravados pela era Companion, e esses registros chegam
 * igualmente velhos pelo `chrome.storage` ou pela ponte. Fosse na plataforma,
 * cada implementação teria que lembrar de aplicar a mesma correção.
 */
import { useEffect, useState } from 'react';
import type { HistoryStatus, MeetingRecord } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';

const VALID_STATUSES: readonly HistoryStatus[] = ['recording', 'ready'];

function normalize(records: MeetingRecord[]): MeetingRecord[] {
  return records.map((record) =>
    (VALID_STATUSES as readonly string[]).includes(record.status)
      ? record
      : { ...record, status: 'ready' as const },
  );
}

export interface HistoryState {
  records: MeetingRecord[];
  /**
   * `false` até a primeira emissão da plataforma.
   *
   * Existe porque lista vazia é AMBÍGUA: pode ser "ainda não chegou" ou
   * "nenhuma reunião guardada". Quem só desenha uma lista não se importa — o
   * vazio some sozinho no quadro seguinte. Quem procura UM registro por id
   * precisa distinguir, senão "não encontrado" acaba mostrado antes de os
   * dados chegarem (ou "carregando" para sempre, num histórico legitimamente
   * vazio).
   */
  loaded: boolean;
}

export function useHistoryState(): HistoryState {
  const platform = usePlatform();
  const [state, setState] = useState<HistoryState>({ records: [], loaded: false });

  useEffect(
    () =>
      platform.subscribeHistory((list) =>
        setState({ records: normalize(list), loaded: true }),
      ),
    [platform],
  );

  return state;
}

/** O caso comum: só a lista. */
export function useHistory(): MeetingRecord[] {
  return useHistoryState().records;
}
