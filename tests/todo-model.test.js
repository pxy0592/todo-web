import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTask,
  createTask,
  removeTask,
  toggleTask,
} from '../src/todo/model.js';

test('trims and creates an incomplete task with an injected id', () => {
  const task = createTask('  Buy milk  ', () => 'task-1');

  assert.deepEqual(task, { id: 'task-1', text: 'Buy milk', completed: false });
});

test('rejects whitespace-only text without changing the list', () => {
  const tasks = [];

  assert.equal(createTask(' \t\n', () => 'unused'), null);
  assert.deepEqual(addTask(tasks, ' \t\n', () => 'unused'), []);
  assert.deepEqual(tasks, []);
});

test('adds a new task without mutating the input list', () => {
  const original = [{ id: 'existing', text: 'Existing', completed: true }];
  const result = addTask(original, ' New task ', () => 'new-task');

  assert.deepEqual(result, [
    { id: 'existing', text: 'Existing', completed: true },
    { id: 'new-task', text: 'New task', completed: false },
  ]);
  assert.notEqual(result, original);
  assert.deepEqual(original, [{ id: 'existing', text: 'Existing', completed: true }]);
});

test('creates unique task IDs from an injected ID sequence', () => {
  const ids = ['task-1', 'task-2'];
  const idFactory = () => ids.shift();
  const tasks = addTask(addTask([], 'First', idFactory), 'Second', idFactory);

  assert.deepEqual(tasks.map(({ id }) => id), ['task-1', 'task-2']);
});

test('toggles an incomplete task to complete without mutating tasks', () => {
  const original = [
    { id: 'a', text: 'A', completed: false },
    { id: 'b', text: 'B', completed: false },
  ];
  const result = toggleTask(original, 'a');

  assert.deepEqual(result, [
    { id: 'a', text: 'A', completed: true },
    { id: 'b', text: 'B', completed: false },
  ]);
  assert.notEqual(result, original);
  assert.equal(result[1], original[1]);
  assert.equal(original[0].completed, false);
});

test('toggles a complete task back to incomplete', () => {
  const original = [{ id: 'a', text: 'A', completed: true }];

  assert.deepEqual(toggleTask(original, 'a'), [
    { id: 'a', text: 'A', completed: false },
  ]);
  assert.equal(original[0].completed, true);
});

test('does not change tasks when toggling an unknown ID', () => {
  const original = [{ id: 'a', text: 'A', completed: false }];
  const result = toggleTask(original, 'missing');

  assert.deepEqual(result, original);
  assert.notEqual(result, original);
  assert.equal(result[0], original[0]);
});

test('removes only the task with the requested ID without mutating tasks', () => {
  const original = [
    { id: 'a', text: 'A', completed: false },
    { id: 'b', text: 'B', completed: true },
  ];
  const result = removeTask(original, 'a');

  assert.deepEqual(result, [{ id: 'b', text: 'B', completed: true }]);
  assert.notEqual(result, original);
  assert.equal(original.length, 2);
  assert.deepEqual(original[0], { id: 'a', text: 'A', completed: false });
});

test('does not change tasks when removing an unknown ID', () => {
  const original = [{ id: 'a', text: 'A', completed: false }];
  const result = removeTask(original, 'missing');

  assert.deepEqual(result, original);
  assert.notEqual(result, original);
  assert.equal(result[0], original[0]);
});
