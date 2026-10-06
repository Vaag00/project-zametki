// Клиент для бэкенда. Сессия хранится в HttpOnly-cookie, её ставит сервер.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  if (res.status === 204) return null;
  // Ответ не JSON — значит, на запрос ответил не наш бэкенд
  // (например, страница открыта через Live Server или как файл)
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError(res.status, 'Бэкенд не отвечает. Запустите сервер и откройте http://localhost:8000');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = typeof data?.detail === 'string' ? data.detail : 'Ошибка сервера';
    throw new ApiError(res.status, msg);
  }
  return data;
}

const Auth = {
  me: () => request('GET', '/auth/me'),
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  register: (username, password) => request('POST', '/auth/register', { username, password }),
  logout: () => request('POST', '/auth/logout'),
};

const NotesStore = {
  list: () => request('GET', '/notes'),
  create: data => request('POST', '/notes', data),
  update: (id, patch) => request('PATCH', `/notes/${encodeURIComponent(id)}`, patch),
  remove: id => request('DELETE', `/notes/${encodeURIComponent(id)}`),
  restore: id => request('POST', `/notes/${encodeURIComponent(id)}/restore`),
};
