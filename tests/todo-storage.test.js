import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEY, loadTasks, saveTasks } from "../src/todo/storage.js";
import { memoryStorage } from "./helpers/memory-storage.js";

const taskA = { id: "a", text: "A", completed: false };
const taskB = { id: "b", text: "B", completed: true };

test("uses the versioned todo storage key", () => {
  assert.equal(STORAGE_KEY, "todo-app.tasks");
});

test("starts with an empty list when the storage key is missing", () => {
  const storage = memoryStorage();

  assert.deepEqual(loadTasks(storage), { tasks: [] });
  assert.equal(storage.setItemCalls.length, 0);
});

test("restores valid version-one task data and does not write while loading", () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({ version: 1, tasks: [taskA, taskB] }),
  });

  assert.deepEqual(loadTasks(storage), { tasks: [taskA, taskB] });
  assert.equal(storage.setItemCalls.length, 0);
});

test("trims restored text while retaining valid task fields", () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      tasks: [{ id: "a", text: "  A  ", completed: false }],
    }),
  });

  assert.deepEqual(loadTasks(storage).tasks, [taskA]);
});

test("fails safe with a warning for malformed JSON", () => {
  const result = loadTasks(memoryStorage({ [STORAGE_KEY]: "{not-json" }));

  assert.deepEqual(result.tasks, []);
  assert.equal(typeof result.warning, "string");
});

test("fails safe for invalid envelopes and unsupported versions", () => {
  for (const value of [
    null,
    [],
    { version: 1, tasks: {} },
    { version: 2, tasks: [taskA] },
    { tasks: [taskA] },
  ]) {
    const result = loadTasks(
      memoryStorage({
        [STORAGE_KEY]: JSON.stringify(value),
      }),
    );

    assert.deepEqual(result.tasks, []);
    assert.equal(typeof result.warning, "string");
  }
});

test("keeps valid records and drops invalid and duplicate records", () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      tasks: [
        { id: "a", text: "A", completed: false },
        { id: "a", text: "duplicate", completed: true },
        { id: "bad", text: "", completed: false },
        { id: "b", text: "B", completed: true },
        { id: "", text: "missing id", completed: false },
        { id: "   ", text: "blank id", completed: false },
        { id: "c", text: "missing completion" },
        { id: "d", text: "wrong completion", completed: "false" },
        { id: 5, text: "wrong id", completed: false },
        { id: "e", text: "  ", completed: false },
        null,
        "not a task",
      ],
    }),
  });

  assert.deepEqual(loadTasks(storage).tasks, [taskA, taskB]);
});

test("returns a warning and empty tasks when reading throws", () => {
  const storage = memoryStorage(
    {},
    {
      getItemError: new Error("read failed"),
    },
  );

  const result = loadTasks(storage);

  assert.deepEqual(result.tasks, []);
  assert.equal(typeof result.warning, "string");
  assert.equal(storage.setItemCalls.length, 0);
});

test("writes a version-one envelope with the supplied tasks", () => {
  const storage = memoryStorage();
  const tasks = [taskA, taskB];

  assert.deepEqual(saveTasks(storage, tasks), { ok: true });
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    version: 1,
    tasks,
  });
  assert.deepEqual(storage.setItemCalls, [
    {
      key: STORAGE_KEY,
      value: JSON.stringify({ version: 1, tasks }),
    },
  ]);
});

test("normalizes tasks before writing by trimming text and dropping invalid duplicates", () => {
  const storage = memoryStorage();
  const tasks = [
    { id: "a", text: "  A  ", completed: false },
    { id: "a", text: "duplicate", completed: true },
    { id: "bad", text: "  ", completed: false },
    { id: "b", text: " B ", completed: true },
    { id: "", text: "missing id", completed: false },
    { id: "c", text: "missing completion" },
  ];

  assert.deepEqual(saveTasks(storage, tasks), { ok: true });
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    version: 1,
    tasks: [taskA, taskB],
  });
});

test("reports a warning instead of throwing when writing throws", () => {
  const storage = memoryStorage(
    {},
    {
      setItemError: new Error("write failed"),
    },
  );

  const result = saveTasks(storage, [taskA]);

  assert.equal(result.ok, false);
  assert.equal(typeof result.warning, "string");
});
