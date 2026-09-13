const MAX_ID_ALLOCATION_ATTEMPTS = 10;

function isValidTaskId(id) {
  return typeof id === "string" && id.trim().length > 0;
}

export function createTask(text, idFactory) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return null;
  }

  const id = idFactory();
  if (!isValidTaskId(id)) {
    return null;
  }

  return {
    id,
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

  for (
    let attempt = 0;
    taskIds.has(taskId) && attempt < MAX_ID_ALLOCATION_ATTEMPTS;
    attempt += 1
  ) {
    taskId = idFactory();
    if (!isValidTaskId(taskId)) {
      return [...tasks];
    }
  }

  // A pathological factory cannot block the caller: reject after the finite retry budget.
  if (taskIds.has(taskId)) {
    return [...tasks];
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
