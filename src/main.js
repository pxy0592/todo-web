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
const storage = window.localStorage;

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
}

bindTodoEvents({
  ...elements,
  onAdd,
  onToggle,
  onRemove,
});
