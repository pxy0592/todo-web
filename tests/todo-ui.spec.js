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
