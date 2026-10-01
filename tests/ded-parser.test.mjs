import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDedClassKey, normalizeDedStudentName, parseDedText, sameDedClassIdentity } from '../frontend/src/ded-parser.js';

const BASE_HEADER = `11:15:44 29/09/2026
181609 - EE PROFESSOR CICERO TORRES GALINDO - SRE UBA
RELACAO NOMINAL DOS ALUNOS ATIVOS DA TURMA`;

test('interpreta a estrutura da lista nominal do DED+', () => {
  const text = `${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno:MANHÃ Professor:ROSANGELA LOPES PELUSO
Endereço:R JOÃO CUSTÓDIO DE MOURA , CENTRO , 118
Componente:LÍNGUA INGLESA
Código Nome Campo Livre
1 7482293 ANDRÉ DIAS VIEIRA
2 9735833 AUGUSTO CABRAL FERNANDES VALENTE
3 9735836 BIANCA RIBEIRO DE OLIVEIRA
Pág. 1 de 1`;

  const result = parseDedText(text, 'lista de aluno.pdf');
  assert.equal(result.schoolCode, '181609');
  assert.equal(result.schoolName, 'EE Professor Cicero Torres Galindo');
  assert.equal(result.classCode, '2076183');
  assert.equal(result.className, '2º EM REG 2 - (2026)');
  assert.equal(result.displayName, '2º EM REG 2 - (2026)');
  assert.equal(result.year, '2026');
  assert.equal(result.component, 'Língua Inglesa');
  assert.equal(result.address, 'R João Custódio de Moura, Centro, 118');
  assert.equal(result.students.length, 3);
  assert.equal(result.students[0].dedCode, '7482293');
  assert.equal(result.students[0].name, 'André Dias Vieira');
});

test('tolera PDF.js removendo espaços entre rótulos do cabeçalho', () => {
  const text = `${BASE_HEADER}
Turma:2076183-2ºEMREG2-(2026)Turno:MANHÃProfessor:ROSANGELA LOPES PELUSO
Endereço:R JOÃO CUSTÓDIO DE MOURA,CENTRO,118
Componente:LÍNGUA INGLESA
CódigoNomeCampo Livre
1 7482293ANDRÉ DIAS VIEIRA
2 9735833 ANA-MARIA DOS SANTOS
3 9735836 AUGUSTO CABRAL FERNANDES VALENTE
Pág.1de1`;

  const result = parseDedText(text);
  assert.equal(result.classCode, '2076183');
  assert.equal(result.className, '2º EM REG 2 - (2026)');
  assert.equal(result.shift, 'Manhã');
  assert.equal(result.teacher, 'Rosangela Lopes Peluso');
  assert.equal(result.students.length, 3);
  assert.equal(result.students[1].name, 'Ana-Maria dos Santos');
});

test('não interrompe uma turma quando o PDF tem várias páginas e repete o cabeçalho', () => {
  const text = `${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno: MANHÃ Professor: ROSANGELA LOPES PELUSO
Componente: LÍNGUA INGLESA
Código Nome Campo Livre
1 100001 PRIMEIRO ALUNO
2 100002 SEGUNDO ALUNO
Pág. 1 de 2
Código Nome Campo Livre
3 100003 TERCEIRO ALUNO
4 100004 QUARTO ALUNO
Pág. 2 de 2`;

  const result = parseDedText(text);
  assert.equal(result.students.length, 4);
  assert.deepEqual(result.students.map(s => s.dedCode), ['100001', '100002', '100003', '100004']);
});

test('a chave DED identifica a mesma turma mesmo quando o componente muda', () => {
  const english = parseDedText(`${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno: MANHÃ Professor: ROSANGELA LOPES PELUSO
Componente: LÍNGUA INGLESA
Código Nome Campo Livre
1 100001 ALUNO UM`);
  const math = parseDedText(`${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno: MANHÃ Professor: ROSANGELA LOPES PELUSO
Componente: MATEMÁTICA
Código Nome Campo Livre
1 100001 ALUNO UM`);
  assert.equal(english.dedKey, math.dedKey);
  assert.equal(sameDedClassIdentity(english, math), true);
});

test('normaliza nomes para comparação sem depender de acentos', () => {
  assert.equal(normalizeDedStudentName('João Vítor da Silva'), 'JOAO VITOR DA SILVA');
  assert.equal(normalizeDedClassKey('  2º   EM REG 2  '), '2º EM REG 2');
});


test('continua reconhecendo alunos quando o cabeçalho da tabela chega fragmentado', () => {
  const text = `${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno: MANHÃ Professor: ROSANGELA LOPES PELUSO
Código
Nome
Campo Livre
1 100001 ALUNO UM
2 100002 ALUNO-DOIS
Pág. 1 de 1`;
  const result = parseDedText(text);
  assert.equal(result.students.length, 2);
  assert.equal(result.students[1].name, 'Aluno-Dois');
});

test('converte campos textuais do DED de caixa alta para apresentação humana', () => {
  const text = `${BASE_HEADER}
Turma: 2076183 - 2º EM REG 2 - (2026) Turno:MANHÃ Professor:ROSANGELA LOPES PELUSO
Endereço:R JOÃO CUSTÓDIO DE MOURA , CENTRO , 118
Componente:LÍNGUA INGLESA
Código Nome Campo Livre
1 7482293 ANDRÉ DIAS VIEIRA
2 9735833 CÉLITON FERNANDES DE OLIVEIRA JÚNIOR`;
  const result = parseDedText(text);
  assert.equal(result.teacher, 'Rosangela Lopes Peluso');
  assert.equal(result.schoolName, 'EE Professor Cicero Torres Galindo');
  assert.equal(result.sre, 'UBA');
  assert.equal(result.shift, 'Manhã');
  assert.equal(result.address, 'R João Custódio de Moura, Centro, 118');
  assert.equal(result.component, 'Língua Inglesa');
  assert.deepEqual(result.students.map(s => s.name), ['André Dias Vieira', 'Céliton Fernandes de Oliveira Júnior']);
});

test('preserva partículas de nomes e siglas de escola', async () => {
  const { formatDedPersonName, formatDedOrganizationName, formatDedClassName, normalizeExistingDedData } = await import('../frontend/src/ded-parser.js');
  assert.equal(formatDedPersonName('MARIA DAS DORES DE SOUZA'), 'Maria das Dores de Souza');
  assert.equal(formatDedOrganizationName('EE PROFESSOR CÍCERO TORRES GALINDO'), 'EE Professor Cícero Torres Galindo');
  assert.equal(formatDedClassName('2ºEMREG2-(2026)'), '2º EM REG 2 - (2026)');

  const original = {
    format: 'ProfessorGest', version: 5, projectId: 'project-test',
    teacher: { name: 'ROSANGELA LOPES PELUSO', school: 'EE PROFESSOR CÍCERO TORRES GALINDO', subject: 'LÍNGUA INGLESA' },
    classes: [{ id: 'c1', name: '2º EM REG 2 - (2026)', archived: false, ded: {
      className: '2º EM REG 2 - (2026)', schoolName: 'EE PROFESSOR CÍCERO TORRES GALINDO', sre: 'UBA', shift: 'MANHÃ',
      teacher: 'ROSANGELA LOPES PELUSO', address: 'R JOÃO CUSTÓDIO DE MOURA , CENTRO , 118', component: 'LÍNGUA INGLESA', key: '181609|2076183|2026'
    }}],
    students: [{ id: 's1', name: 'ANDRÉ DIAS VIEIRA', classId: 'c1', ded: { studentCode: '7482293' }}], activities: [], occurrences: [], plans: []
  };
  const migrated = normalizeExistingDedData(original);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.data.teacher.name, 'Rosangela Lopes Peluso');
  assert.equal('school' in migrated.data.teacher, false);
  assert.equal('subject' in migrated.data.teacher, false);
  assert.equal(migrated.data.classes[0].ded.component, 'Língua Inglesa');
  assert.equal(migrated.data.students[0].name, 'André Dias Vieira');
});
