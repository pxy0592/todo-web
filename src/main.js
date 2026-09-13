import { addTask, removeTask, toggleTask } from './todo/model.js';
import { loadTasks, saveTasks } from './todo/storage.js';
import { bindTodoEvents, renderTasks } from './todo/ui.js';

const elements = {
  form: document.querySelector('#task-form'),
  input: document.querySelector('#task-input'),
  listElement: document.querySelector('#task-list'),
  emptyStateElement: document.querySelector('#empty-state'),
  statusElement: document.querySelector('#status'),
};

let tasks = [];

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function acquireStorage() {
  try {
    const candidate = window.localStorage;
    if (candidate
      && typeof candidate.getItem === 'function'
      && typeof candidate.setItem === 'function') {
      return { storage: candidate, warning: '' };
    }
  } catch {
    // Fall through to the in-memory session storage below.
  }

  return {
    storage: createMemoryStorage(),
    warning: 'Unable to access saved tasks.',
  };
}

const acquiredStorage = acquireStorage();
const storage = acquiredStorage.storage;

function setStatus(message = '') {
  elements.statusElement.textContent = message;
  elements.statusElement.hidden = !message;
}

function render() {
  renderTasks(elements, tasks);
}

function persist() {
  const result = saveTasks(storage, tasks);
  if (result.warning) {
    setStatus(result.warning);
  }
}

function onAdd(text) {
  const nextTasks = addTask(tasks, text, () => window.crypto.randomUUID());
  if (nextTasks.length === tasks.length) {
    return false;
  }

  tasks = nextTasks;
  render();
  persist();
  return true;
}

function onToggle(taskId) {
  tasks = toggleTask(tasks, taskId);
  render();
  persist();
}

function onRemove(taskId) {
  tasks = removeTask(tasks, taskId);
  render();
  persist();
}

const loaded = loadTasks(storage);
tasks = loaded.tasks;
render();
if (loaded.warning) {
  setStatus(loaded.warning);
} else if (acquiredStorage.warning) {
  setStatus(acquiredStorage.warning);
}

bindTodoEvents({
  ...elements,
  onAdd,
  onToggle,
  onRemove,
});
