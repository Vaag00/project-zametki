const COLORS = ['default', 'yellow', 'green', 'blue', 'pink', 'purple'];

const DESIGNS = [
  { id: 'neon',    name: 'Неон',      hint: 'Тёмный, со свечением',            colors: ['#07070f', '#22d3ee', '#f472b6'] },
  { id: 'classic', name: 'Классика',  hint: 'Спокойный и аккуратный',          colors: ['#f6f5f2', '#4f46e5', '#fff6c7'] },
  { id: 'paper',   name: 'Бумага',    hint: 'Карточки на скотче, засечки',     colors: ['#efe8da', '#9a3412', '#fbf0c4'] },
  { id: 'glass',   name: 'Стекло',    hint: 'Матовое стекло на градиенте',     colors: ['#6d28d9', '#db2777', '#f59e0b'] },
  { id: 'brutal',  name: 'Брутализм', hint: 'Толстые рамки, жёсткие тени',     colors: ['#ffe14d', '#000000', '#ff4f00'] },
];

const state = {
  user: null,
  notes: [],
  filter: 'all',   // all | pinned | archived
  tag: null,
  query: '',
  sort: 'updated',
  editingId: null, // id редактируемой заметки или null для новой
  draft: null,     // pinned/archived/color для открытого редактора
};

const $ = sel => document.querySelector(sel);
const els = {
  search: $('#search'),
  newNote: $('#new-note'),
  emptyNew: $('#empty-new'),
  themeToggle: $('#theme-toggle'),
  designBtn: $('#design-btn'),
  designMenu: $('#design-menu'),
  filters: document.querySelectorAll('.filter'),
  tagList: $('#tag-list'),
  sort: $('#sort'),
  pinnedSection: $('#pinned-section'),
  pinnedGrid: $('#pinned-grid'),
  notesGrid: $('#notes-grid'),
  mainTitle: $('#main-title'),
  empty: $('#empty'),
  emptyText: $('#empty-text'),
  editor: $('#editor'),
  form: $('#editor-form'),
  title: $('#note-title'),
  body: $('#note-body'),
  tags: $('#note-tags'),
  colors: $('#colors'),
  pinBtn: $('#pin-btn'),
  archiveBtn: $('#archive-btn'),
  deleteBtn: $('#delete-btn'),
  cancelBtn: $('#cancel-btn'),
  meta: $('#meta'),
  toast: $('#toast'),
  app: $('#app'),
  auth: $('#auth'),
  authTabs: document.querySelectorAll('.auth-tab'),
  authForm: $('#auth-form'),
  authUsername: $('#auth-username'),
  authPassword: $('#auth-password'),
  authError: $('#auth-error'),
  authSubmit: $('#auth-submit'),
  userName: $('#user-name'),
  logout: $('#logout'),
};

/* ---------- Утилиты ---------- */

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? 'сегодня, ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function parseTags(str) {
  return [...new Set(
    str.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  )];
}

let toastTimer;
function toast(message, action) {
  clearTimeout(toastTimer);
  els.toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick = () => { action.run(); els.toast.classList.remove('show'); };
    els.toast.append(btn);
  }
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4000);
}

// Сессия истекла — возвращаем на экран входа, иначе показываем ошибку
function handleError(err) {
  if (err.status === 401) {
    if (els.editor.open) els.editor.close();
    showAuth();
    toast('Сессия истекла, войдите снова');
  } else {
    toast(err.message || 'Что-то пошло не так');
  }
}

/* ---------- Отрисовка ---------- */

function visibleNotes() {
  const q = state.query.toLowerCase();
  return state.notes
    .filter(n => state.filter === 'archived' ? n.archived : !n.archived)
    .filter(n => state.filter !== 'pinned' || n.pinned)
    .filter(n => !state.tag || n.tags.includes(state.tag))
    .filter(n => !q
      || n.title.toLowerCase().includes(q)
      || n.body.toLowerCase().includes(q)
      || n.tags.some(t => t.includes(q)))
    .sort((a, b) => {
      if (state.sort === 'title') return (a.title || a.body).localeCompare(b.title || b.body, 'ru');
      const key = state.sort === 'created' ? 'createdAt' : 'updatedAt';
      return b[key].localeCompare(a[key]);
    });
}

function noteCard(note) {
  const card = document.createElement('article');
  card.className = 'note';
  card.dataset.color = note.color;
  card.tabIndex = 0;
  const title = note.title || (note.body ? '' : 'Без названия');
  card.innerHTML = `
    <button class="icon-btn quick ${note.pinned ? 'on' : ''}" title="${note.pinned ? 'Открепить' : 'Закрепить'}">${note.pinned ? '📌' : '📍'}</button>
    ${title ? `<h3>${highlight(title, state.query)}</h3>` : ''}
    ${note.body ? `<p>${highlight(note.body, state.query)}</p>` : ''}
    ${note.tags.length ? `<div class="note-tags">${note.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    <div class="note-date">${formatDate(note.updatedAt)}</div>
  `;
  card.querySelector('.quick').addEventListener('click', e => {
    e.stopPropagation();
    togglePin(note);
  });
  card.addEventListener('click', () => openEditor(note));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') openEditor(note); });
  return card;
}

function renderCounts() {
  const active = state.notes.filter(n => !n.archived);
  $('#count-all').textContent = active.length;
  $('#count-pinned').textContent = active.filter(n => n.pinned).length;
  $('#count-archived').textContent = state.notes.filter(n => n.archived).length;
}

function renderTags() {
  const tags = [...new Set(state.notes.flatMap(n => n.tags))].sort((a, b) => a.localeCompare(b, 'ru'));
  if (state.tag && !tags.includes(state.tag)) state.tag = null;
  els.tagList.innerHTML = tags.length ? '' : '<span class="muted-small">Тегов пока нет</span>';
  for (const tag of tags) {
    const btn = document.createElement('button');
    btn.className = 'tag' + (tag === state.tag ? ' active' : '');
    btn.textContent = '#' + tag;
    btn.onclick = () => {
      state.tag = state.tag === tag ? null : tag;
      render();
    };
    els.tagList.append(btn);
  }
}

function render() {
  renderCounts();
  renderTags();

  const notes = visibleNotes();
  const splitPinned = state.filter === 'all';
  const pinned = splitPinned ? notes.filter(n => n.pinned) : [];
  const others = splitPinned ? notes.filter(n => !n.pinned) : notes;

  els.pinnedGrid.replaceChildren(...pinned.map(noteCard));
  els.notesGrid.replaceChildren(...others.map(noteCard));
  els.pinnedSection.hidden = pinned.length === 0;
  els.mainTitle.hidden = pinned.length === 0 || others.length === 0;

  const isEmpty = notes.length === 0;
  els.empty.hidden = !isEmpty;
  if (isEmpty) {
    els.emptyText.textContent =
      state.query || state.tag ? 'Ничего не найдено'
      : state.filter === 'archived' ? 'Архив пуст'
      : state.filter === 'pinned' ? 'Нет закреплённых заметок'
      : 'Здесь пока пусто — создайте первую заметку';
    els.emptyNew.hidden = state.filter === 'archived' || Boolean(state.query);
  }
}

/* ---------- Редактор ---------- */

function renderColorPicker() {
  els.colors.replaceChildren(...COLORS.map(color => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (state.draft.color === color ? ' selected' : '');
    b.dataset.color = color;
    b.style.background = `var(--note-${color})`;
    b.title = color;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', state.draft.color === color);
    b.onclick = () => {
      state.draft.color = color;
      els.editor.dataset.color = color;
      renderColorPicker();
    };
    return b;
  }));
}

function syncEditorButtons() {
  els.pinBtn.classList.toggle('active', state.draft.pinned);
  els.pinBtn.title = state.draft.pinned ? 'Открепить' : 'Закрепить';
  els.archiveBtn.classList.toggle('active', state.draft.archived);
  els.archiveBtn.title = state.draft.archived ? 'Вернуть из архива' : 'В архив';
}

function openEditor(note = null) {
  state.editingId = note?.id ?? null;
  state.draft = {
    color: note?.color ?? 'default',
    pinned: note?.pinned ?? false,
    archived: note?.archived ?? false,
  };
  els.title.value = note?.title ?? '';
  els.body.value = note?.body ?? '';
  els.tags.value = note?.tags.join(', ') ?? (state.tag || '');
  els.editor.dataset.color = state.draft.color;
  els.deleteBtn.hidden = !note;
  els.meta.textContent = note
    ? `Изменено ${formatDate(note.updatedAt)} · создано ${formatDate(note.createdAt)}`
    : '';
  renderColorPicker();
  syncEditorButtons();
  els.editor.showModal();
  (note ? els.body : els.title).focus();
}

async function saveEditor() {
  const data = {
    title: els.title.value.trim(),
    body: els.body.value.trim(),
    tags: parseTags(els.tags.value),
    ...state.draft,
  };
  if (!data.title && !data.body) {
    if (state.editingId) toast('Пустая заметка не сохранена');
    return;
  }
  if (state.editingId) {
    const updated = await NotesStore.update(state.editingId, data);
    state.notes = state.notes.map(n => n.id === updated.id ? updated : n);
  } else {
    state.notes.push(await NotesStore.create(data));
    toast('Заметка создана');
  }
  render();
}

async function deleteNote(id) {
  try {
    await NotesStore.remove(id);
  } catch (err) {
    return handleError(err);
  }
  state.notes = state.notes.filter(n => n.id !== id);
  render();
  toast('Заметка удалена', {
    label: 'Отменить',
    run: async () => {
      try {
        state.notes.push(await NotesStore.restore(id));
        render();
      } catch (err) {
        handleError(err);
      }
    },
  });
}

async function togglePin(note) {
  try {
    const updated = await NotesStore.update(note.id, { pinned: !note.pinned });
    state.notes = state.notes.map(n => n.id === updated.id ? updated : n);
    render();
  } catch (err) {
    handleError(err);
  }
}

/* ---------- Авторизация ---------- */

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  els.authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  els.authSubmit.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти';
  els.authPassword.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  els.authError.hidden = true;
}

function showAuth() {
  state.user = null;
  state.notes = [];
  els.app.hidden = true;
  els.auth.hidden = false;
  els.authPassword.value = '';
  els.authUsername.focus();
}

async function showApp(user) {
  state.user = user;
  els.userName.textContent = user.username;
  els.auth.hidden = true;
  els.app.hidden = false;
  state.notes = await NotesStore.list();
  render();
}

function authErrorText() {
  const username = els.authUsername.value.trim();
  if (!username) return 'Введите логин';
  if (authMode === 'register' && !/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) {
    return 'Логин: от 3 до 30 символов — буквы, цифры, «_», «.» или «-»';
  }
  if (authMode === 'register' && els.authPassword.value.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (!els.authPassword.value) return 'Введите пароль';
  return null;
}

async function submitAuth(e) {
  e.preventDefault();
  const error = authErrorText();
  els.authError.hidden = !error;
  els.authError.textContent = error ?? '';
  if (error) return;

  els.authSubmit.disabled = true;
  try {
    const username = els.authUsername.value.trim();
    const user = authMode === 'register'
      ? await Auth.register(username, els.authPassword.value)
      : await Auth.login(username, els.authPassword.value);
    els.authPassword.value = '';
    await showApp(user);
  } catch (err) {
    els.authError.textContent = err.message;
    els.authError.hidden = false;
  } finally {
    els.authSubmit.disabled = false;
  }
}

/* ---------- Тема ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('notes-app:theme', theme); } catch {}
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('notes-app:theme'); } catch {}
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));

  let design = null;
  try { design = localStorage.getItem(DESIGN_KEY); } catch {}
  applyDesign(DESIGNS.some(d => d.id === design) ? design : DEFAULT_DESIGN, false);
}

/* ---------- Дизайн ---------- */

// Запоминаем только явный выбор пользователя, чтобы смена дизайна
// по умолчанию дошла и до тех, кто ничего не выбирал
const DESIGN_KEY = 'notes-app:design-choice';
const DEFAULT_DESIGN = 'neon';

function applyDesign(id, remember = true) {
  document.documentElement.dataset.design = id;
  if (remember) {
    try { localStorage.setItem(DESIGN_KEY, id); } catch {}
  }
  renderDesignMenu();
}

function renderDesignMenu() {
  const current = document.documentElement.dataset.design;
  els.designMenu.replaceChildren(...DESIGNS.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'design-option' + (d.id === current ? ' selected' : '');
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', d.id === current);
    b.innerHTML = `
      <span class="design-preview">${d.colors.map(c => `<span style="background:${c}"></span>`).join('')}</span>
      <span><strong>${d.name}</strong><small>${d.hint}</small></span>`;
    b.onclick = () => applyDesign(d.id);
    return b;
  }));
}

function toggleDesignMenu(open = els.designMenu.hidden) {
  els.designMenu.hidden = !open;
  els.designBtn.setAttribute('aria-expanded', open);
}

/* ---------- События ---------- */

els.newNote.addEventListener('click', () => openEditor());
els.emptyNew.addEventListener('click', () => openEditor());

els.search.addEventListener('input', e => {
  state.query = e.target.value.trim();
  render();
});

els.sort.addEventListener('change', e => {
  state.sort = e.target.value;
  render();
});

els.filters.forEach(btn => btn.addEventListener('click', () => {
  els.filters.forEach(b => b.classList.toggle('active', b === btn));
  state.filter = btn.dataset.filter;
  render();
}));

els.designBtn.addEventListener('click', e => {
  e.stopPropagation();
  toggleDesignMenu();
});
document.addEventListener('click', e => {
  if (!els.designMenu.hidden && !els.designMenu.contains(e.target)) toggleDesignMenu(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !els.designMenu.hidden) toggleDesignMenu(false);
});

els.themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

els.form.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await saveEditor();
    els.editor.close();
  } catch (err) {
    handleError(err);
  }
});

els.authTabs.forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));
els.authForm.addEventListener('submit', submitAuth);

els.logout.addEventListener('click', async () => {
  try { await Auth.logout(); } catch {}
  els.search.value = '';
  state.query = '';
  state.tag = null;
  showAuth();
});

els.cancelBtn.addEventListener('click', () => els.editor.close());

els.pinBtn.addEventListener('click', () => {
  state.draft.pinned = !state.draft.pinned;
  if (state.draft.pinned) state.draft.archived = false;
  syncEditorButtons();
});

els.archiveBtn.addEventListener('click', () => {
  state.draft.archived = !state.draft.archived;
  if (state.draft.archived) state.draft.pinned = false;
  syncEditorButtons();
});

els.deleteBtn.addEventListener('click', async () => {
  const id = state.editingId;
  els.editor.close();
  await deleteNote(id);
});

// Клик по фону закрывает редактор
els.editor.addEventListener('click', e => {
  if (e.target === els.editor) els.editor.close();
});

// Горячие клавиши
document.addEventListener('keydown', e => {
  if (els.editor.open) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') els.form.requestSubmit();
    return;
  }
  if (!state.user) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); els.search.focus(); }
  if (e.key.toLowerCase() === 'n' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openEditor(); }
  if (e.key === 'Escape' && document.activeElement === els.search) { els.search.value = ''; state.query = ''; render(); els.search.blur(); }
});

/* ---------- Старт ---------- */

async function init() {
  initTheme();
  try {
    await showApp(await Auth.me());
  } catch (err) {
    showAuth();
    if (err.status !== 401) toast(err.message);
  }
}

init();
