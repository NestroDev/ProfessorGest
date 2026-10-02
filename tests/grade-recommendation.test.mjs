import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OCCURRENCE_TYPES, DEFAULT_GRADE_SETTINGS, normalizeGradeSettings, recommendGrade, formatGrade, formatPoints,
} from '../frontend/src/grade-recommendation.js';
import { PRG_FORMAT, PRG_VERSION, validateProjectData } from '../frontend/src/prof-model.js';
import { emptySchoolIds } from '../frontend/src/project-selectors.js';

const occ = (type, extra = {}) => ({ id: `o-${type}-${Math.random()}`, studentId: 's1', date: '2026-09-01', type, ...extra });

test('todo tipo de ocorrência é positivo, negativo ou neutro e tem peso padrão', () => {
  for (const type of OCCURRENCE_TYPES) {
    assert.ok(['positiva', 'negativa', 'neutra'].includes(type.polarity), type.key);
    assert.equal(typeof DEFAULT_GRADE_SETTINGS.weights[type.key], 'number', type.key);
    if (type.polarity === 'positiva') assert.ok(DEFAULT_GRADE_SETTINGS.weights[type.key] >= 0);
    if (type.polarity === 'negativa') assert.ok(DEFAULT_GRADE_SETTINGS.weights[type.key] <= 0);
  }
});

test('nota recomendada parte da base e soma os pontos de cada registro', () => {
  const result = recommendGrade([occ('participou'), occ('fez_atividade'), occ('nao_atividade'), occ('observacao')], DEFAULT_GRADE_SETTINGS);
  assert.equal(result.grade, 7);
  assert.equal(result.positive, 2);
  assert.equal(result.negative, 1);
  assert.equal(result.neutral, 1);
  assert.deepEqual(result.byCategory.map(c => [c.key, c.count, c.points]), [
    ['dever', 2, -0.25], ['participacao', 1, 0.25], ['outros', 1, 0],
  ]);
  assert.equal(recommendGrade([], DEFAULT_GRADE_SETTINGS).grade, 7);
});

test('nota fica entre 0 e a nota máxima e respeita pesos configurados', () => {
  const many = type => Array.from({ length: 40 }, () => occ(type));
  assert.equal(recommendGrade(many('bom_comportamento'), DEFAULT_GRADE_SETTINGS).grade, 10);
  assert.equal(recommendGrade(many('mau_comportamento'), DEFAULT_GRADE_SETTINGS).grade, 0);
  const custom = { base: 60, max: 100, weights: { conversou: -5, participou: '2,5' } };
  assert.equal(recommendGrade([occ('conversou'), occ('participou')], custom).grade, 57.5);
  assert.equal(recommendGrade([occ('tipo_desconhecido')], custom).grade, 60);
});

test('configuração inválida volta para valores seguros', () => {
  const normalized = normalizeGradeSettings({ base: 50, max: -3, weights: { conversou: 'abc', participou: 999 } });
  assert.equal(normalized.max, 10);
  assert.equal(normalized.base, 10);
  assert.equal(normalized.weights.conversou, DEFAULT_GRADE_SETTINGS.weights.conversou);
  assert.equal(normalized.weights.participou, 10);
  assert.deepEqual(normalizeGradeSettings(null), normalizeGradeSettings(DEFAULT_GRADE_SETTINGS));
});

test('formatação em pt-BR', () => {
  assert.equal(formatGrade(7.5), '7,5');
  assert.equal(formatPoints(0.25), '+0,25');
  assert.equal(formatPoints(-1), '−1');
});

test('projeto preserva gradeSettings e os novos tipos de ocorrência', () => {
  const data = {
    format: PRG_FORMAT, version: PRG_VERSION, projectId: 'P1', teacher: { name: 'Ana' },
    schools: [], classes: [], assignments: [], enrollments: [], activities: [], plans: [],
    students: [{ id: 's1', name: 'Bia', classId: null }],
    occurrences: [occ('fez_atividade', { id: 'o1' }), occ('mau_comportamento', { id: 'o2' })],
    gradeSettings: { base: 6, max: 10, weights: { conversou: -1 } },
  };
  const validated = validateProjectData(data);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.data.occurrences.map(o => o.type), ['fez_atividade', 'mau_comportamento']);
  assert.equal(validated.data.gradeSettings.base, 6);
  assert.equal(validated.data.gradeSettings.weights.conversou, -1);
  const { gradeSettings, ...withoutSettings } = data;
  assert.equal('gradeSettings' in validateProjectData(withoutSettings).data, false);
});

test('escolas sem turmas são identificadas para remoção', () => {
  const state = {
    schools: [{ id: 'a', name: 'Escola A' }, { id: 'b', name: 'Escola B' }, { id: 'c', name: 'Escola C' }],
    classes: [{ id: 't1', schoolId: 'a' }, { id: 't2', schoolId: null, ded: { schoolName: 'Escola C' } }],
  };
  assert.deepEqual(emptySchoolIds(state), ['b']);
  assert.deepEqual(emptySchoolIds({ ...state, classes: [] }), ['a', 'b', 'c']);
});
