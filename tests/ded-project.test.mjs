import test from 'node:test';
import assert from 'node:assert/strict';
import { PRG_FORMAT, PRG_VERSION, validateProjectData } from '../frontend/src/prof-model.js';
import { previewDedProjectUpdate, dedupeDedItems, describeDedSummary } from '../frontend/src/ded-project.js';
import { createMemoryAdapter, createProjectStore } from '../frontend/src/project-store.js';

const empty = () => ({ format: PRG_FORMAT, version: PRG_VERSION, projectId: 'P1', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  teacher: { name: '' }, schools: [], classes: [], assignments: [], enrollments: [], students: [], activities: [], occurrences: [], plans: [] });
let n = 0; const uid = p => `${p}_${++n}`;
const pdf = (over = {}) => ({ sourceName: 'a.pdf', dedKey: '1|2A|2026', schoolCode: '1', schoolName: 'Escola Aurora', classCode: '2A', year: '2026',
  displayName: '2º A', className: '2º A', shift: 'Manhã', teacher: 'Rosangela', component: 'Inglês',
  students: [{ dedCode: '1', name: 'Ana' }, { dedCode: '2', name: 'Bruno' }], ...over });

test('DED+ cria turmas novas a partir de vários PDFs e adiciona sem substituir as existentes', () => {
  const base = empty();
  base.classes.push({ id: 'manual', name: 'Turma manual', archived: false });
  const res = previewDedProjectUpdate(base, [pdf(), pdf({ sourceName: 'b.pdf', dedKey: '1|3B|2026', classCode: '3B', displayName: '3º B', students: [{ dedCode: '9', name: 'Caio' }] })], { uid });
  assert.equal(res.ok, true);
  assert.equal(res.summary.classesAdded, 2);
  assert.equal(res.summary.newStudents, 3);
  assert.equal(res.state.classes.length, 3);
  assert.ok(res.state.classes.some(c => c.id === 'manual'));
  assert.equal(base.classes.length, 1, 'estado original intacto (prévia)');
  assert.equal(res.state.teacher.name, 'Rosangela');
  assert.equal(validateProjectData(res.state).ok, true, 'o resultado continua um projeto válido');
});

test('atualização: reconhece turma existente, novos, renomeados e PRESERVA ausentes e histórico', () => {
  const first = previewDedProjectUpdate(empty(), [pdf()], { uid }).state;
  const ana = first.students.find(s => s.name === 'Ana');
  first.occurrences.push({ id: 'o1', studentId: ana.id, date: '2026-03-01', type: 'participou', description: '' });
  first.classes[0].name = 'Meu nome da turma';
  const updated = previewDedProjectUpdate(first, [pdf({ students: [{ dedCode: '1', name: 'Ana Maria' }, { dedCode: '3', name: 'Carla' }] })], { uid });
  assert.equal(updated.summary.classesUpdated, 1);
  assert.equal(updated.summary.classesAdded, 0);
  assert.equal(updated.summary.newStudents, 1);
  assert.equal(updated.summary.renamedStudents, 1);
  assert.equal(updated.summary.preservedMissing, 1);
  const names = updated.state.students.map(s => s.name).sort();
  assert.deepEqual(names, ['Ana Maria', 'Bruno', 'Carla']);
  assert.equal(updated.state.students.find(s => s.id === ana.id).name, 'Ana Maria', 'mesmo aluno, histórico mantido');
  assert.equal(updated.state.occurrences.length, 1);
  assert.equal(updated.state.classes.length, 1);
  assert.equal(updated.state.classes[0].name, 'Meu nome da turma', 'nome dado pelo professor é preservado');
  assert.equal(updated.reports[0].missing[0], 'Bruno');
  assert.ok(describeDedSummary(updated.summary).includes('1 aluno ausente preservado'));
});

test('misto: atualiza uma turma e cria outra na mesma operação; PDFs repetidos são ignorados', () => {
  const first = previewDedProjectUpdate(empty(), [pdf()], { uid }).state;
  const res = previewDedProjectUpdate(first, [pdf(), pdf({ sourceName: 'dup.pdf' }), pdf({ sourceName: 'n.pdf', dedKey: '1|1C|2026', classCode: '1C', displayName: '1º C' })], { uid });
  assert.equal(res.duplicates.length, 1);
  assert.equal(res.summary.classesUpdated, 1);
  assert.equal(res.summary.classesAdded, 1);
  assert.equal(dedupeDedItems([pdf(), pdf()]).unique.length, 1);
});

test('uma nova disciplina na mesma turma não duplica a turma', () => {
  const first = previewDedProjectUpdate(empty(), [pdf()], { uid }).state;
  const res = previewDedProjectUpdate(first, [pdf({ component: 'Matemática' })], { uid });
  assert.equal(res.state.classes.length, 1);
  assert.equal(res.state.assignments.length, 2);
  assert.equal(res.summary.assignmentsAdded, 1);
  assert.equal(res.state.students.length, 2, 'alunos não duplicados');
});

test('resultado da atualização persiste no projeto e sobrevive à reabertura', async () => {
  const store = createProjectStore({ adapter: createMemoryAdapter() });
  await store.createProject(empty());
  const res = previewDedProjectUpdate((await store.getProject('P1')).state, [pdf()], { uid });
  await store.createBackup('P1', 'Antes da atualização DED+');
  await store.saveProject(res.state);
  const reopened = createProjectStore({ adapter: store.adapter });
  const meta = await reopened.getProjectMeta('P1');
  assert.equal(meta.classCount, 1); assert.equal(meta.studentCount, 2);
  assert.equal((await reopened.listBackups('P1')).length, 1);
});
