function createTaskRow(task) {
  const row = document.createElement('li');
  row.className = 'task-row';
  row.dataset.taskId = task.id;
  row.dataset.completed = String(task.completed);
  if (task.completed) {
    row.classList.add('completed');
  }

  const label = document.createElement('label');
  label.className = 'task-label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', task.text);

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-task';
  deleteButton.textContent = '删除';
  deleteButton.setAttribute('aria-label', `删除${task.text}`);

  label.append(checkbox, text);
  row.append(label, deleteButton);
  return row;
}

export function renderTasks({ listElement, emptyStateElement }, tasks) {
  listElement.replaceChildren();

  for (const task of tasks) {
    listElement.append(createTaskRow(task));
  }

  emptyStateElement.hidden = tasks.length > 0;
}

export function bindTodoEvents({ form, input, listElement, onAdd, onToggle, onRemove }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onAdd(input.value);
    input.value = '';
  };

  const handleListChange = (event) => {
    if (event.target.matches('input[type="checkbox"]')) {
      const row = event.target.closest('[data-task-id]');
      if (row) {
        onToggle(row.dataset.taskId);
      }
    }
  };

  const handleListClick = (event) => {
    if (event.target.matches('button.delete-task')) {
      const row = event.target.closest('[data-task-id]');
      if (row) {
        onRemove(row.dataset.taskId);
      }
    }
  };

  form.addEventListener('submit', handleSubmit);
  listElement.addEventListener('change', handleListChange);
  listElement.addEventListener('click', handleListClick);

  return () => {
    form.removeEventListener('submit', handleSubmit);
    listElement.removeEventListener('change', handleListChange);
    listElement.removeEventListener('click', handleListClick);
  };
}
