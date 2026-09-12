export const STORAGE_KEY = 'todo-app.tasks';
const STORAGE_VERSION = 1;

function warning(message) {
  return { tasks: [], warning: message };
}

function isValidTaskRecord(record) {
  return record !== null
    && typeof record === 'object'
    && !Array.isArray(record)
    && typeof record.id === 'string'
    && record.id.trim().length > 0
    && typeof record.text === 'string'
    && record.text.trim().length > 0
    && typeof record.completed === 'boolean';
}

function normalizeTasks(records) {
  const ids = new Set();
  const tasks = [];

  for (const record of records) {
    if (!isValidTaskRecord(record) || ids.has(record.id)) {
      continue;
    }

    ids.add(record.id);
    tasks.push({
      id: record.id,
      text: record.text.trim(),
      completed: record.completed,
    });
  }

  return tasks;
}

export function loadTasks(storage) {
  let serialized;

  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch {
    return warning('Unable to read saved tasks.');
  }

  if (serialized === null || serialized === undefined) {
    return { tasks: [] };
  }

  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    return warning('Saved tasks are malformed.');
  }

  if (envelope === null
    || typeof envelope !== 'object'
    || Array.isArray(envelope)
    || envelope.version !== STORAGE_VERSION
    || !Array.isArray(envelope.tasks)) {
    return warning('Saved tasks have an unsupported format.');
  }

  return { tasks: normalizeTasks(envelope.tasks) };
}

export function saveTasks(storage, tasks) {
  try {
    const serialized = JSON.stringify({
      version: STORAGE_VERSION,
      tasks: normalizeTasks(tasks),
    });
    storage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch {
    return { ok: false, warning: 'Unable to save tasks.' };
  }
}
