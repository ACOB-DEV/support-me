import { test, expect } from '@playwright/test';
import {
  setupE2EMocks,
  setAuthenticatedSession,
  MOCK_USER_ADDRESS,
} from './fixtures/test-mocks';

test.describe('Subscription Flows', () => {
  test('user can start a recurring subscription on creator profile', async ({ page }) => {
    await setupE2EMocks(page);

    // 1. Visit creator profile
    await page.goto('/alice');

    // 2. Connect wallet
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await expect(page.getByText(/Wallet: GDHJ/i)).toBeVisible();

    // 3. Enable recurring checkbox
    const recurringCheckbox = page.getByRole('checkbox', { name: 'Make it recurring' });
    await expect(recurringCheckbox).toBeVisible();
    await recurringCheckbox.check();

    // 4. Verify interval selector is visible and defaults to Monthly (30)
    const intervalSelect = page.getByRole('combobox').filter({ hasText: /monthly/i });
    await expect(intervalSelect).toBeVisible();
    await expect(intervalSelect).toHaveValue('30');

    // 5. Button label updates to recurring donation action
    const startRecurringBtn = page.getByRole('button', { name: 'Start Recurring Donation' });
    await expect(startRecurringBtn).toBeVisible();
    await startRecurringBtn.click();

    // 6. Verify success toast notification
    await expect(page.getByText('Recurring donation started!')).toBeVisible({ timeout: 10000 });

    // 7. Verify recurring checkbox resets to unchecked
    await expect(recurringCheckbox).not.toBeChecked();
  });

  test('user can view and cancel an active subscription', async ({ page }) => {
    const activeSub = {
      id: 1,
      creatorId: 1,
      creator: {
        username: 'alice',
        displayName: 'Alice Creator',
        avatarUrl: null,
      },
      supporterAddress: MOCK_USER_ADDRESS,
      token: 'XLM',
      amount: 10,
      intervalSecs: 30 * 86400,
      onChainId: 1,
      nextChargeAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      active: true,
      lastChargeTxHash: null,
      lastChargedAt: null,
      lastError: null,
    };

    await setupE2EMocks(page, {
      subscriptions: [activeSub],
    });
    await setAuthenticatedSession(page);

    // 1. Navigate to subscriptions management page
    await page.goto('/app/subscriptions');

    // 2. Verify subscription details are rendered
    await expect(page.getByRole('heading', { level: 1, name: 'Subscriptions' })).toBeVisible();
    await expect(page.getByText('Alice Creator')).toBeVisible();
    await expect(page.getByText(/10 XLM · monthly/i)).toBeVisible();

    // 3. Click Cancel button and confirm in dialog
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    const confirmBtn = page.getByRole('button', { name: 'Cancel donation' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 4. Verify success toast
    await expect(page.getByText('Subscription cancelled')).toBeVisible({ timeout: 10000 });

    // 5. Verify status updates to Cancelled and button is removed
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  });

  test('displays empty state when user has no subscriptions', async ({ page }) => {
    await setupE2EMocks(page, { subscriptions: [] });
    await setAuthenticatedSession(page);

    await page.goto('/app/subscriptions');

    await expect(page.getByRole('heading', { level: 1, name: 'Subscriptions' })).toBeVisible();
    await expect(
      page.getByText("You don't have any recurring donations yet. Start one from a creator's profile page.")
    ).toBeVisible();
  });
});
