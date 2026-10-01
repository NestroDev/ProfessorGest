export const SAVE_STATES = Object.freeze({
  IDLE: 'idle',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SAVED: 'saved',
  SYNCING: 'syncing',
  SYNCED: 'synced',
});

const KNOWN_TRANSITIONS = new Map(
  Object.values(SAVE_STATES).map(state => [state, new Set(Object.values(SAVE_STATES))]),
);

export function isSaveState(value) {
  return Object.values(SAVE_STATES).includes(value);
}

export function transitionSaveState(current, next) {
  if (!isSaveState(current) || !isSaveState(next)) {
    throw new Error(
      `Estado de salvamento desconhecido: ${String(current)} -> ${String(next)}`,
    );
  }

  const from = current;
  const target = next;
  if (!KNOWN_TRANSITIONS.get(from)?.has(target)) {
    throw new Error(`Transição de salvamento inválida: ${from} -> ${target}`);
  }

  return target;
}
