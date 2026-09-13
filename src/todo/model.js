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

  if (task === null) {
    return [...tasks];
  }

  const taskIds = new Set(tasks.map(({ id }) => id));
  let taskId = task.id;
  while (taskIds.has(taskId)) {
    taskId = idFactory();
  }

  return [...tasks, { ...task, id: taskId }];
}

export function toggleTask(tasks, taskId) {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, completed: !task.completed } : task,
  );
}

export function removeTask(tasks, taskId) {
  return tasks.filter((task) => task.id !== taskId);
}
