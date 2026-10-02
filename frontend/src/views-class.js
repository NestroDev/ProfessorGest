export function createClassViewRenderers(deps) {
  const {
    getState,
    getCtx,
    classById,
    classStats,
    studentsOf,
    occurrencesOf,
    studentById,
    assignmentsOf = () => [],
    schoolNameOf = () => 'Escola não informada',
    assignmentById = () => null,
    initials,
    activityListItemHTML,
    esc,
    fmtDate,
    todayISO,
    emptyState,
    badgeFor,
    ICONS,
    studentGrade = () => null,
    formatGrade = value => String(value),
    formatPoints = value => String(value),
  } = deps;

  function gradeTone(result) {
    const ratio = result.max ? result.grade / result.max : 0;
    if (ratio >= 0.7) return 'good';
    if (ratio >= 0.5) return 'mid';
    return 'low';
  }

  function renderClassGradesTab(classroom, students, selected) {
    const ctx = getCtx();
    const from = ctx.gradeFrom || '';
    const to = ctx.gradeTo || '';
    const rows = students
      .map(student => ({
        student,
        result: studentGrade(student.id, {
          classId: classroom.id,
          assignmentId: selected?.id || '',
          from,
          to,
        }),
      }))
      .filter(row => row.result)
      .sort((a, b) => a.student.name.localeCompare(b.student.name, 'pt-BR'));

    return `
      <div class="card grade-filter-card">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="gradeFromInput">De</label>
            <input class="form-input" type="date" id="gradeFromInput" value="${esc(from)}">
          </div>
          <div class="form-group">
            <label class="form-label" for="gradeToInput">Até</label>
            <input class="form-input" type="date" id="gradeToInput" value="${esc(to)}">
          </div>
        </div>
        <div class="row-between grade-filter-foot">
          <p class="form-hint">
            Nota sugerida a partir dos registros positivos e negativos${
              selected ? ` de ${esc(selected.subject)} e dos registros sem disciplina` : ''
            }. Ela é só uma referência: confira antes de lançar.
          </p>
          <button type="button" class="btn-secondary btn-sm" id="btnGradeSettings">
            ${ICONS.settings || ICONS.edit} Ajustar pontos
          </button>
        </div>
      </div>
      <div class="card list-card">
        ${
          rows
            .map(({ student, result }) => {
              const detail = result.total
                ? [
                    `${result.positive} ${result.positive === 1 ? 'positiva' : 'positivas'}`,
                    `${result.negative} ${result.negative === 1 ? 'negativa' : 'negativas'}`,
                    ...result.byCategory
                      .filter(category => category.points)
                      .map(category => `${category.label} ${formatPoints(category.points)}`),
                  ].join(' · ')
                : 'Sem registros no período · nota base';

              return `
                <div class="list-item">
                  <div
                    class="list-item-main"
                    data-open-student="${esc(student.id)}"
                    role="button"
                    tabindex="0"
                  >
                    <div class="avatar sm">${initials(student.name)}</div>
                    <div>
                      <div class="list-item-title">${esc(student.name)}</div>
                      <div class="list-item-sub">${esc(detail)}</div>
                    </div>
                  </div>
                  <div class="grade-value grade-${gradeTone(result)}" aria-label="Nota recomendada ${esc(formatGrade(result.grade))} de ${esc(formatGrade(result.max))}">
                    <strong>${esc(formatGrade(result.grade))}</strong><span>/ ${esc(formatGrade(result.max))}</span>
                  </div>
                </div>
              `;
            })
            .join('') || emptyState('Nenhum aluno nesta turma.')
        }
      </div>
    `;
  }

  function renderClassStudentsTab(classroom) {
    const alunos = studentsOf(classroom.id);
    const ctx = getCtx();
    const bulk = ctx.bulkMode;

    return `
      <div class="row-between compact-section-head">
        <div>
          <strong>${alunos.length}</strong>
          ${alunos.length === 1 ? 'aluno acompanhado' : 'alunos acompanhados'}
        </div>
        <div class="inline-actions">
          <button type="button" class="btn-ghost btn-sm" id="btnToggleBulk">
            ${bulk ? 'Cancelar seleção' : 'Selecionar vários'}
          </button>
          <button type="button" class="btn-primary btn-sm" id="btnAddStudentHere">
            ${ICONS.plus} Aluno
          </button>
        </div>
      </div>
      ${
        bulk
          ? `
            <div class="bulk-bar student-bulk-bar">
              <div>
                <strong>
                  ${ctx.bulkSelected.size}
                  ${ctx.bulkSelected.size === 1 ? 'selecionado' : 'selecionados'}
                </strong>
              </div>
              <div class="bulk-bar-actions">
                <button type="button" class="btn-secondary btn-sm" id="btnBulkSelectAll">
                  Selecionar todos
                </button>
                <button type="button" class="btn-secondary btn-sm" id="btnBulkOccurrence">
                  ${ICONS.bell} Registrar ocorrência
                </button>
                <button type="button" class="btn-secondary btn-sm" id="btnBulkMoveStudents">
                  ${ICONS.move} Mudar de turma
                </button>
                <button type="button" class="btn-danger-solid btn-sm" id="btnBulkDelete">
                  ${ICONS.trash} Excluir
                </button>
                <button type="button" class="btn-ghost btn-sm" id="btnBulkClear">
                  Limpar
                </button>
              </div>
            </div>
          `
          : ''
      }
      <div class="card list-card">
        ${
          alunos
            .map(student => {
              const occurrenceCount = occurrencesOf(student.id).length;

              return `
                <div class="list-item">
                  ${
                    bulk
                      ? `
                        <label class="list-item-check">
                          <input
                            type="checkbox"
                            data-bulk-student="${esc(student.id)}"
                            ${ctx.bulkSelected.has(student.id) ? 'checked' : ''}
                            aria-label="Selecionar ${esc(student.name)}"
                          >
                        </label>
                      `
                      : ''
                  }
                  <div
                    class="list-item-main"
                    data-open-student="${esc(student.id)}"
                    role="button"
                    tabindex="0"
                  >
                    <div class="avatar sm">${initials(student.name)}</div>
                    <div>
                      <div class="list-item-title">${esc(student.name)}</div>
                      <div class="list-item-sub">
                        ${occurrenceCount}
                        ${occurrenceCount === 1 ? 'registro' : 'registros'} de acompanhamento
                      </div>
                    </div>
                  </div>
                  ${
                    bulk
                      ? ''
                      : `
                        <div class="list-item-actions">
                          <button
                            type="button"
                            class="btn-icon"
                            data-edit-student="${esc(student.id)}"
                            aria-label="Editar aluno"
                          >
                            ${ICONS.edit}
                          </button>
                          <button
                            type="button"
                            class="btn-icon danger"
                            data-del-student="${esc(student.id)}"
                            aria-label="Excluir aluno"
                          >
                            ${ICONS.trash}
                          </button>
                        </div>
                      `
                  }
                </div>
              `;
            })
            .join('') ||
          emptyState(
            'Nenhum aluno acompanhado nesta turma ainda.',
            'Adicione alunos quando precisar acompanhar alguém.',
          )
        }
      </div>
    `;
  }

  function renderTurmaDetail() {
    const ctx = getCtx();
    const state = getState();
    const classroom = classById(ctx.classId);

    if (!classroom) return emptyState('Turma não encontrada.');

    const assignments = assignmentsOf(classroom.id);
    const selected =
      assignmentById(ctx.assignmentId) || assignments[0] || null;

    if (selected && ctx.assignmentId !== selected.id) {
      ctx.assignmentId = selected.id;
    }

    const stats = classStats(classroom, selected?.id);
    const tab = ctx.classTab || 'visao';
    const tabs = [
      { key: 'visao', label: 'Visão geral' },
      { key: 'alunos', label: 'Alunos' },
      { key: 'atividades', label: 'Atividades' },
      { key: 'ocorrencias', label: 'Registros' },
      { key: 'notas', label: 'Notas' },
      { key: 'relatorios', label: 'Relatórios' },
    ];

    let body = '';

    if (tab === 'visao') {
      const upcomingActivities = stats.acts
        .filter(activity => activity.dueDate >= todayISO())
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 5);
      const studentIds = new Set(stats.alunos.map(student => student.id));
      const recentOccurrences = state.occurrences
        .filter(
          occurrence =>
            studentIds.has(occurrence.studentId) &&
            (!selected || occurrence.assignmentId === selected.id),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);

      body = `
        <div class="dashboard-stats class-detail-stats">
          <div class="card dashboard-stat">
            <div class="stat-icon">${ICONS.user}</div>
            <div>
              <strong>${stats.alunos.length}</strong>
              <span>Alunos acompanhados</span>
            </div>
          </div>
          <div class="card dashboard-stat">
            <div class="stat-icon">${ICONS.clipboard}</div>
            <div>
              <strong>${stats.acts.length}</strong>
              <span>Atividades</span>
            </div>
          </div>
          <div class="card dashboard-stat">
            <div class="stat-icon">${ICONS.bell}</div>
            <div>
              <strong>${stats.occCount}</strong>
              <span>Registros</span>
            </div>
          </div>
        </div>
        <div class="dashboard-grid">
          <section>
            <div class="section-heading">
              <div>
                <h2>Próximas atividades</h2>
                <p>
                  ${
                    selected
                      ? `Agenda de ${esc(selected.subject)}.`
                      : 'Agenda desta turma.'
                  }
                </p>
              </div>
            </div>
            <div class="card list-card">
              ${
                upcomingActivities.map(activity => activityListItemHTML(activity)).join('') ||
                emptyState('Nenhuma atividade futura.')
              }
            </div>
          </section>
          <section>
            <div class="section-heading">
              <div>
                <h2>Registros recentes</h2>
                <p>Últimos acompanhamentos.</p>
              </div>
            </div>
            <div class="card list-card">
              ${
                recentOccurrences
                  .map(occurrence => {
                    const student = studentById(occurrence.studentId);
                    return `
                      <div class="list-item">
                        <div
                          class="list-item-main"
                          data-open-student="${esc(occurrence.studentId)}"
                          role="button"
                          tabindex="0"
                        >
                          <div class="list-item-title">
                            ${esc(student ? student.name : 'Aluno removido')}
                          </div>
                          <div class="list-item-sub">
                            ${fmtDate(occurrence.date)} ${badgeFor(occurrence.type)}
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join('') || emptyState('Nenhum registro ainda.')
              }
            </div>
          </section>
        </div>
      `;
    } else if (tab === 'alunos') {
      body = renderClassStudentsTab(classroom);
    } else if (tab === 'atividades') {
      body = `
        <div class="row-between compact-section-head">
          <div></div>
          <button type="button" class="btn-primary btn-sm" id="btnNewActivityHere">
            ${ICONS.plus} Nova atividade
          </button>
        </div>
        <div class="card list-card">
          ${
            stats.acts.map(activity => activityListItemHTML(activity)).join('') ||
            emptyState('Nenhuma atividade nesta disciplina.')
          }
        </div>
      `;
    } else if (tab === 'ocorrencias') {
      const studentIds = new Set(stats.alunos.map(student => student.id));
      const occurrences = state.occurrences
        .filter(
          occurrence =>
            studentIds.has(occurrence.studentId) &&
            (!selected || occurrence.assignmentId === selected.id),
        )
        .sort((a, b) => b.date.localeCompare(a.date));

      body = `
        <div class="card list-card">
          ${
            occurrences
              .map(occurrence => {
                const student = studentById(occurrence.studentId);
                return `
                  <div class="list-item">
                    <div
                      class="list-item-main"
                      data-open-student="${esc(occurrence.studentId)}"
                      role="button"
                      tabindex="0"
                    >
                      <div class="list-item-title">
                        ${esc(student ? student.name : 'Aluno removido')}
                      </div>
                      <div class="list-item-sub">
                        ${fmtDate(occurrence.date)} ${badgeFor(occurrence.type)}${
                          occurrence.description
                            ? ` · ${esc(occurrence.description)}`
                            : ''
                        }
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('') || emptyState('Nenhum registro para esta disciplina.')
          }
        </div>
      `;
    } else if (tab === 'notas') {
      body = renderClassGradesTab(classroom, stats.alunos, selected);
    } else {
      body = `
        <div class="card narrow-card">
          <p class="muted">
            Gere um relatório com os alunos acompanhados, atividades, registros e observações deste contexto.
          </p>
          <button type="button" class="btn-primary btn-block" id="btnGoClassReport">
            ${ICONS.report} Gerar relatório da turma
          </button>
        </div>
      `;
    }

    const school = schoolNameOf(classroom.id);
    const meta = [
      classroom.year ? `Ano ${classroom.year}` : '',
      classroom.shift || '',
    ]
      .filter(Boolean)
      .join(' · ');

    return `
      <button type="button" class="btn-ghost btn-sm page-back" id="btnBack">
        ${ICONS.back} Voltar
      </button>
      <section class="card detail-hero-card class-detail-hero">
        <div class="row-between">
          <div>
            <div class="list-item-title detail-title">
              ${esc(classroom.name)}
              ${
                classroom.archived
                  ? '<span class="badge badge-gray">Arquivada</span>'
                  : ''
              }
            </div>
            <div class="list-item-sub">
              ${esc(school)}${meta ? ` · ${esc(meta)}` : ''}
            </div>
          </div>
          <div class="inline-actions">
            <button type="button" class="btn-primary btn-sm" id="btnRegisterForClass">
              ${ICONS.plus} Registrar
            </button>
            ${
              selected?.ded?.key
                ? `
                  <button type="button" class="btn-secondary btn-sm" id="btnUpdateClassFromDed">
                    ${ICONS.refresh} Atualizar ${esc(selected.subject)} com DED
                  </button>
                `
                : ''
            }
            <button type="button" class="btn-secondary btn-sm" id="btnEditThisClass">
              ${ICONS.edit} Editar
            </button>
          </div>
        </div>
        <div class="class-assignment-switcher">
          <div class="section-title">Disciplina</div>
          <div class="quick-options">
            ${
              assignments.length
                ? assignments
                    .map(
                      assignment => `
                        <button
                          type="button"
                          class="quick-opt ${selected?.id === assignment.id ? 'selected' : ''}"
                          data-class-assignment="${esc(assignment.id)}"
                        >
                          ${esc(assignment.subject)}
                        </button>
                      `,
                    )
                    .join('')
                : '<span class="muted">Nenhuma disciplina definida. Você pode adicioná-la ao importar do DED+.</span>'
            }
          </div>
        </div>
      </section>
      <div class="tabs responsive-tabs">
        ${
          tabs
            .map(
              tabItem => `
                <button
                  type="button"
                  class="tab ${tab === tabItem.key ? 'active' : ''}"
                  data-class-tab="${esc(tabItem.key)}"
                >
                  ${tabItem.label}
                </button>
              `,
            )
            .join('')
        }
      </div>
      ${body}
    `;
  }

  return {
    renderTurmaDetail,
    renderClassStudentsTab,
  };
}
