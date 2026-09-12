import { test, expect } from '@playwright/test';

async function renderFixture(page, tasks) {
  await page.evaluate(async (fixtureTasks) => {
    const { renderTasks } = await import('/src/todo/ui.js');
    renderTasks(
      {
        listElement: document.querySelector('#task-list'),
        emptyStateElement: document.querySelector('#empty-state'),
      },
      fixtureTasks,
    );
  }, tasks);
}

test.describe('todo semantic UI', () => {
  test('exposes a labelled task input and 添加 button', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('textbox', { name: '任务' })).toBeVisible();
    await expect(page.getByRole('button', { name: '添加' })).toBeVisible();
  });

  test('shows the empty state when no tasks are rendered', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('status', { name: '任务列表状态' })).toContainText('暂无任务');
    await expect(page.getByRole('listitem')).toHaveCount(0);
  });

  test('renders each task row with its checkbox and delete control', async ({ page }) => {
    await page.goto('/');
    await renderFixture(page, [
      { id: 'task-1', text: '购买牛奶', completed: false },
      { id: 'task-2', text: '整理书桌', completed: false },
    ]);

    const rows = page.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-task-id', 'task-1');
    await expect(rows.nth(0).getByRole('checkbox', { name: '购买牛奶' })).toBeVisible();
    await expect(rows.nth(0).getByRole('button', { name: '删除购买牛奶' })).toBeVisible();
    await expect(rows.nth(1).getByRole('checkbox', { name: '整理书桌' })).toBeVisible();
    await expect(rows.nth(1).getByRole('button', { name: '删除整理书桌' })).toBeVisible();
    await expect(page.getByRole('status', { name: '任务列表状态' })).toBeHidden();
  });

  test('exposes completed styling hooks and checked state', async ({ page }) => {
    await page.goto('/');
    await renderFixture(page, [
      { id: 'task-1', text: '完成报告', completed: true },
    ]);

    const row = page.getByRole('listitem');
    const text = row.getByText('完成报告');
    await expect(row).toHaveClass(/completed/);
    await expect(row).toHaveAttribute('data-completed', 'true');
    await expect(row.getByRole('checkbox', { name: '完成报告' })).toBeChecked();
    await expect(text).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('renders HTML-like task text literally without creating an image', async ({ page }) => {
    await page.goto('/');
    const taskText = '<img src=x onerror=alert(1)>';
    await renderFixture(page, [
      { id: 'unsafe-task', text: taskText, completed: false },
    ]);

    const row = page.getByRole('listitem');
    await expect(row).toContainText(taskText);
    await expect(row.locator('img')).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: taskText })).toBeVisible();
    await expect(row.getByRole('button', { name: `删除${taskText}` })).toBeVisible();
  });
});

test.describe('todo interactions and persistence', () => {
  test('adds a task with a click, clears the input, and restores it after reload', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox', { name: '任务' });
    await input.fill('  购买牛奶  ');
    await page.getByRole('button', { name: '添加' }).click();

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('购买牛奶');
    await expect(input).toHaveValue('');

    await page.getByRole('checkbox', { name: '购买牛奶' }).check();
    await page.reload();

    await expect(page.getByRole('listitem')).toContainText('购买牛奶');
    await expect(page.getByRole('checkbox', { name: '购买牛奶' })).toBeChecked();
  });

  test('submits a task with Enter', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox', { name: '任务' });
    await input.fill('整理书桌');
    await input.press('Enter');

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('整理书桌');
    await expect(input).toHaveValue('');
  });

  test('does not add or clear a blank submission', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox', { name: '任务' });
    await input.fill('   ');
    await page.getByRole('button', { name: '添加' }).click();

    await expect(page.getByRole('listitem')).toHaveCount(0);
    await expect(input).toHaveValue('   ');
  });

  test('toggles completed styling in both directions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: '任务' }).fill('完成报告');
    await page.getByRole('button', { name: '添加' }).click();

    const row = page.getByRole('listitem');
    const checkbox = row.getByRole('checkbox', { name: '完成报告' });
    await checkbox.check();
    await expect(row).toHaveClass(/completed/);
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect(row).not.toHaveClass(/completed/);
    await expect(checkbox).not.toBeChecked();
  });

  test('deletes only the targeted task and keeps it deleted after reload', async ({ page }) => {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '任务' });
    const addButton = page.getByRole('button', { name: '添加' });

    await input.fill('保留任务');
    await addButton.click();
    await input.fill('删除任务');
    await addButton.click();

    await page.getByRole('button', { name: '删除删除任务' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('保留任务');
    await expect(page.getByRole('listitem')).not.toContainText('删除任务');

    await page.reload();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('保留任务');
    await expect(page.getByRole('listitem')).not.toContainText('删除任务');
  });

  test('shows a non-blocking status when saving fails without losing the task', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error('storage unavailable');
      };
    });
    await page.goto('/');

    await page.getByRole('textbox', { name: '任务' }).fill('无法保存的任务');
    await page.getByRole('button', { name: '添加' }).click();

    await expect(page.getByRole('listitem')).toContainText('无法保存的任务');
    await expect(page.getByRole('status', { name: '操作状态' })).toContainText('Unable to save tasks.');
  });
});
