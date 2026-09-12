export function createTask(text, idFactory) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return null;
  }

  return {
    id: idFactory(),
    text: normalizedText,
    completed: false,
  };
}

export function addTask(tasks, text, idFactory) {
  const task = createTask(text, idFactory);

  return task === null ? [...tasks] : [...tasks, task];
}

export function toggleTask(tasks, taskId) {
  return tasks.map((task) => (
    task.id === taskId
      ? { ...task, completed: !task.completed }
      : task
  ));
}

export function removeTask(tasks, taskId) {
  return tasks.filter((task) => task.id !== taskId);
}
