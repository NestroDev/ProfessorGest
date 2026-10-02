/**
 * Tipos de ocorrência (positivas, negativas e neutras) e cálculo da nota recomendada.
 * A nota parte de uma base e soma/subtrai os pontos configurados para cada tipo de registro.
 */

export const OCCURRENCE_CATEGORIES = Object.freeze([
  { key: 'comportamento', label: 'Comportamento' },
  { key: 'dever', label: 'Atividades e deveres' },
  { key: 'participacao', label: 'Participação' },
  { key: 'frequencia', label: 'Frequência' },
  { key: 'outros', label: 'Outros' },
]);

export const OCCURRENCE_POLARITIES = Object.freeze([
  { key: 'positiva', label: 'Positivas' },
  { key: 'negativa', label: 'Negativas' },
  { key: 'neutra', label: 'Neutras' },
]);

export const OCCURRENCE_TYPES = Object.freeze([
  { key: 'participou',        label: 'Participou da aula',        tone: 'green', polarity: 'positiva', category: 'participacao' },
  { key: 'bom_comportamento', label: 'Bom comportamento',         tone: 'green', polarity: 'positiva', category: 'comportamento' },
  { key: 'fez_atividade',     label: 'Entregou atividade/dever',  tone: 'green', polarity: 'positiva', category: 'dever' },
  { key: 'nao_atividade',     label: 'Não fez atividade',         tone: 'red',   polarity: 'negativa', category: 'dever' },
  { key: 'conversou',         label: 'Conversou durante a aula',  tone: 'amber', polarity: 'negativa', category: 'comportamento' },
  { key: 'mau_comportamento', label: 'Comportamento inadequado',  tone: 'red',   polarity: 'negativa', category: 'comportamento' },
  { key: 'faltou',            label: 'Faltou',                    tone: 'gray',  polarity: 'neutra',   category: 'frequencia' },
  { key: 'observacao',        label: 'Outra observação',          tone: 'blue',  polarity: 'neutra',   category: 'outros' },
]);

export const OCCURRENCE_TYPE_KEYS = new Set(OCCURRENCE_TYPES.map(type => type.key));

export const DEFAULT_GRADE_SETTINGS = Object.freeze({
  base: 7,
  max: 10,
  weights: Object.freeze({
    participou: 0.25,
    bom_comportamento: 0.25,
    fez_atividade: 0.25,
    nao_atividade: -0.5,
    conversou: -0.25,
    mau_comportamento: -0.5,
    faltou: 0,
    observacao: 0,
  }),
});

const MAX_GRADE_SCALE = 1000;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function occurrenceTypeOf(key) {
  return OCCURRENCE_TYPES.find(type => type.key === key) || null;
}

/** Garante uma configuração válida (números finitos, base dentro da escala, pesos limitados). */
export function normalizeGradeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const maxValue = finiteOr(source.max, DEFAULT_GRADE_SETTINGS.max);
  const max = round2(maxValue > 0 ? Math.min(maxValue, MAX_GRADE_SCALE) : DEFAULT_GRADE_SETTINGS.max);
  const base = round2(clamp(finiteOr(source.base, Math.min(DEFAULT_GRADE_SETTINGS.base, max)), 0, max));
  const rawWeights = source.weights && typeof source.weights === 'object' ? source.weights : {};
  const weights = {};
  for (const type of OCCURRENCE_TYPES) {
    weights[type.key] = round2(clamp(finiteOr(rawWeights[type.key], DEFAULT_GRADE_SETTINGS.weights[type.key] ?? 0), -max, max));
  }
  return { base, max, weights };
}

/**
 * Calcula a nota recomendada a partir de uma lista de ocorrências (já filtrada pelo chamador).
 * A nota final fica sempre entre 0 e a nota máxima.
 */
export function recommendGrade(occurrences, settings) {
  const config = normalizeGradeSettings(settings);
  const categories = new Map(OCCURRENCE_CATEGORIES.map(category => [category.key, { ...category, count: 0, points: 0 }]));
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let delta = 0;

  for (const occurrence of occurrences || []) {
    const type = occurrenceTypeOf(occurrence?.type) || occurrenceTypeOf('observacao');
    const weight = config.weights[type.key] || 0;
    if (type.polarity === 'positiva') positive += 1;
    else if (type.polarity === 'negativa') negative += 1;
    else neutral += 1;
    delta += weight;
    const category = categories.get(type.category);
    category.count += 1;
    category.points += weight;
  }

  return {
    grade: round2(clamp(config.base + delta, 0, config.max)),
    base: config.base,
    max: config.max,
    delta: round2(delta),
    positive,
    negative,
    neutral,
    total: positive + negative + neutral,
    byCategory: [...categories.values()]
      .filter(category => category.count > 0)
      .map(category => ({ ...category, points: round2(category.points) })),
  };
}

export function formatGrade(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatPoints(value) {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : number < 0 ? '−' : ''}${formatGrade(Math.abs(number))}`;
}
