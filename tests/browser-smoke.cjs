// Optional browser checks; see README for the Playwright setup and local server command.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        const violations = [];
        const audit = async location => {
            const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            violations.push(...results.violations.map(item => ({ location, id: item.id, nodes: item.nodes.map(node => node.target) })));
        };
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(process.env.APP_URL || 'http://localhost:8000', { waitUntil: 'networkidle' });
        assert.equal(await page.locator('#nav-ride').getAttribute('aria-current'), 'page');
        await page.screenshot({ path: '/tmp/cadence-desktop.png', fullPage: true });

        await page.locator('#nav-design').click();
        const name = `Rider's <img src=x onerror=alert(1)>`;
        await page.locator('#workoutName').fill(name);
        await page.getByRole('button', { name: 'Warmup 50% FTP' }).click();
        await page.getByRole('button', { name: 'Tempo 85% FTP' }).click();
        await page.getByRole('button', { name: 'Edit Warmup, 5:00' }).click();
        assert.equal(await page.locator('#intervalDialog').evaluate(dialog => dialog.open), true);
        await audit('interval dialog');
        await page.locator('#intervalName').fill('Progressive warmup');
        await page.locator('#intervalPowerType').selectOption('ramp');
        await page.locator('#intervalPower').fill('0');
        await page.locator('#intervalRampEnd').fill('100');
        await page.locator('#intervalDuration').fill('60');
        await page.getByRole('button', { name: 'Save interval' }).click();
        assert.equal(await page.locator('#intervalDialog').evaluate(dialog => dialog.open), false);
        assert.equal(await page.evaluate(() => workoutDesigner.intervals[0].percentageLow), 0);
        await page.getByRole('button', { name: 'Save workout', exact: true }).click();
        assert.match(await page.locator('#saveWorkoutStatus').textContent(), /Saved/);
        await page.locator('#nav-workouts').click();
        assert.equal(await page.locator('.workout-card-title').textContent(), name);
        assert.equal(await page.locator('.workout-card img').count(), 0);
        await page.locator('.workout-card-title').click();
        assert.equal(await page.locator('#content-ride').isVisible(), true);
        assert.equal(await page.locator('#startWorkoutBtn').isVisible(), true);

        // Exercise the real workout lifecycle without requesting a physical Bluetooth device.
        await page.evaluate(() => {
            app.ftms.isConnected = () => true;
            app.ftms.setTargetPower = async () => true;
            app.ftms.device = { name: 'Test trainer' };
            app.ftms.onConnectionChange(true);
        });
        assert.equal(await page.locator('#targetPowerValue').textContent(), '0');
        await page.locator('#startWorkoutBtn').click();
        await page.evaluate(() => app.handleMetricsUpdate({ power: 180, cadence: 90, cadenceSource: 'ftms', hr: 145 }));
        assert.equal(await page.locator('#activeWorkoutCard').isVisible(), true);
        assert.equal(await page.locator('#cadenceValue').textContent(), '90');
        assert.equal(await page.locator('#powerDisplay').textContent(), '100%');
        await page.screenshot({ path: '/tmp/cadence-active.png', fullPage: true });
        await audit('active workout');
        await page.locator('#stopWorkoutBtn').click();
        assert.equal(await page.locator('#workoutSummaryCard').isVisible(), true);
        assert.equal(await page.evaluate(() => workoutDesigner.isRunning), false);
        await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
        assert.equal(await page.locator('#workoutControlCard').isVisible(), true);

        await page.getByRole('button', { name: 'Manage trainer and heart rate monitor' }).click();
        assert.equal(await page.locator('#devicesDialog').evaluate(dialog => dialog.open), true);
        await audit('devices dialog');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#devicesDialog').evaluate(dialog => dialog.open), false);

        await page.locator('#nav-session').click();
        await audit('group entry form');
        await page.evaluate(() => {
            app.sessionManager.sessionId = 'test-group-ride';
            app.sessionManager.myPeerId = 'self';
            app.sessionManager.userName = 'Test rider';
            app.sessionManager.isHost = true;
            app.updateSessionUI('test-group-ride', true);
            app.handleParticipantUpdate([
                { id: 'self', name: 'Test rider', ftp: 200, power: 180, cadence: 90, heartRate: 145, progress: 0.3, isHost: true },
                { id: 'friend', name: 'Fellow rider', ftp: 240, power: 215, cadence: 88, heartRate: 140, progress: 0.3 }
            ]);
        });
        await page.screenshot({ path: '/tmp/cadence-group.png', fullPage: true });
        for (const width of [1440, 1024, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            for (const tab of ['ride', 'workouts', 'design', 'session']) {
                await page.locator(`#nav-${tab}`).click();
                assert.equal(await page.locator(`#content-${tab}`).isVisible(), true);
                assert.equal(await page.locator('.app-nav .active').count(), 1);
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
                assert.ok(overflow <= 1, `${tab} at ${width}px overflows by ${overflow}px`);
                if (width === 1440 || width === 390) {
                    await audit(`${tab} at ${width}px`);
                }
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#nav-ride').click();
        await page.screenshot({ path: '/tmp/cadence-mobile.png', fullPage: true });
        assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: editing, saving, library, riding, summary, dialogs, responsive layout and accessibility.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
