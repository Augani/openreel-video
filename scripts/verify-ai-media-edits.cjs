// Runs against a production preview or the deployed app. Only model responses
// are deterministic fixtures; media import, tools, preview and undo use the app.
const { chromium, expect } = require('../apps/studio/node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const baseURL = process.env.OPENREEL_BROWSER_URL || 'http://127.0.0.1:4173';
const directory = process.env.OPENREEL_EVIDENCE_DIR || '/tmp/openreel-ai-media-evidence';
const video = process.env.OPENREEL_TEST_VIDEO;
assert.ok(video && fs.existsSync(video), 'Set OPENREEL_TEST_VIDEO to a local video at least four seconds long');
fs.mkdirSync(directory, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    ...(process.env.OPENREEL_CHROMIUM ? { executablePath: process.env.OPENREEL_CHROMIUM } : {}),
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let scenario = 'trim', step = 0, mediaId, trackId, clipId, clipIds;
    let requestCount = 0;
    const failures = [];
    const traces = [];
    const call = (name, input) => ({ name, input });

    await context.route('https://fixture.invalid/v1/chat/completions', async (route) => {
      try {
        requestCount++;
        const body = route.request().postDataJSON();
        const results = body.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
        for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
        const latest = results.at(-1)?.data;
        const definition = body.tools.find((tool) => tool.function.name === 'add_video_effect').function;
        assert.equal(definition.parameters.properties.params.properties.amount.type, 'number');
        assert.ok(definition.description.includes('vignette: amount (0..1)'));
        let calls = [];
        if (scenario === 'trim') {
          if (step === 0) calls = [call('list_media', {}), call('list_tracks', {}), call('list_clips', {})];
          else if (step === 1) {
            const media = results.at(-3).data;
            assert.equal(media.length, 1);
            mediaId = media[0].id;
            assert.equal(media[0].type, 'video');
            assert.equal(latest.length, 0, 'Imported media must start off the timeline');
            calls = [call('add_track', { trackType: 'video' })];
          } else if (step === 2) {
            trackId = latest.trackId; assert.ok(trackId);
            calls = [call('add_clip', { trackId, mediaId, startTime: 0, inPoint: 0.5, outPoint: 3.5 })];
          } else if (step === 3) {
            clipId = latest.clipId; assert.ok(clipId);
            assert.equal(latest.duration, 3);
            calls = [call('trim_clip', { clipId, outPoint: 3 })];
          }
        } else if (scenario === 'effect') {
          if (step === 0) calls = [call('get_clip', { clipId })];
          else if (step === 1) calls = [call('split_clip', { clipId, time: 1.25 })];
          else if (step === 2) {
            clipIds = latest.clipIds; assert.equal(clipIds.length, 2);
            calls = [
              call('add_transition', { clipAId: clipIds[0], clipBId: clipIds[1], transitionType: 'crossfade', duration: 0.25 }),
              call('add_video_effect', { clipId: clipIds[0], effectType: 'vignette', params: { intensity: 0.3 } }),
            ];
          } else if (step === 3) {
            assert.ok(latest.effectId);
            calls = [call('update_video_effect', { clipId: clipIds[0], effectId: latest.effectId, params: { amount: 0.4, feather: 0.7 } })];
          }
        }
        traces.push({ scenario, step, calls, results });
        step++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          choices: [{ message: { content: calls.length ? '' : `${scenario} fixture complete.`,
            ...(calls.length ? { tool_calls: calls.map((tool, index) => ({ id: `${scenario}-${step}-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) } : {}),
          }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 },
        }) });
      } catch (error) {
        failures.push(error.message);
        await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      }
    });

    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Create Horizontal project', exact: true }).click();
    const skip = page.getByRole('button', { name: 'Skip tour', exact: true }).first();
    await skip.waitFor(); await skip.click();
    await page.getByRole('button', { name: 'AI editing', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'AI base URL' })).toHaveCount(0);
    const composer = page.getByRole('textbox', { name: 'AI edit request' });
    await composer.fill('Keep my draft while I change settings');
    await page.getByRole('button', { name: 'AI settings', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'AI Editor', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('textbox', { name: 'AI base URL' }).fill('https://fixture.invalid/v1');
    await page.getByRole('textbox', { name: 'AI model ID' }).fill('fixture-tool-model');
    await page.getByRole('textbox', { name: 'Session API key' }).fill('fixture-session-key');
    await page.screenshot({ path: `${directory}/ai-settings.png`, fullPage: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'AI base URL' })).toHaveCount(0);
    await expect(composer).toHaveValue('Keep my draft while I change settings');
    await page.getByRole('button', { name: 'AI settings', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'AI model ID' })).toHaveValue('fixture-tool-model');
    await expect(page.getByRole('textbox', { name: 'Session API key' })).toHaveValue('fixture-session-key');
    await page.setViewportSize({ width: 820, height: 900 });
    await expect.poll(() => page.getByRole('dialog').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && getComputedStyle(element).opacity === '1';
    })).toBe(true);
    await page.screenshot({ path: `${directory}/ai-settings-820.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'AI base URL' })).toHaveCount(0);
    await page.screenshot({ path: `${directory}/chat-820.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await composer.fill('');
    await page.locator('input[aria-label="Import media"]').setInputFiles(video);
    await page.getByText(path.basename(video), { exact: true }).first().waitFor();

    const send = async (text) => {
      step = 0;
      await page.getByRole('textbox', { name: 'AI edit request' }).fill(text);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(() => failures.length ? failures.join('; ') : step, { timeout: 60000 }).toBe(5);
      await page.getByText(`${scenario} fixture complete.`, { exact: true }).waitFor();
      assert.deepEqual(failures, []);
    };
    const exportEdit = async () => {
      await page.getByText('Edit JSON & reusable presets', { exact: true }).click();
      await page.getByRole('button', { name: 'Export edit JSON', exact: true }).click();
      const value = JSON.parse(await page.getByRole('textbox', { name: 'Edit or preset JSON' }).inputValue());
      await page.getByText('Edit JSON & reusable presets', { exact: true }).click();
      return value;
    };

    await send('Trim the uploaded video to seconds 0.5 through 3 and put it on the timeline.');
    const trimmed = await exportEdit();
    let clips = trimmed.project.timeline.tracks.flatMap((track) => track.clips);
    assert.equal(clips.length, 1);
    assert.deepEqual([clips[0].mediaId, clips[0].inPoint, clips[0].outPoint, clips[0].duration], [mediaId, 0.5, 3, 2.5]);
    await page.screenshot({ path: `${directory}/trimmed-timeline.png`, fullPage: true });

    scenario = 'effect';
    await send('Cut the clip in half, add a dissolve and a vignette with strength 0.3, then adjust it to 0.4.');
    const edited = await exportEdit();
    clips = edited.project.timeline.tracks.flatMap((track) => track.clips);
    assert.equal(clips.length, 2);
    assert.deepEqual(clips.map((clip) => clip.id), clipIds);
    assert.deepEqual(clips[0].effects[0].params, { amount: 0.4, feather: 0.7 });
    assert.equal(edited.project.timeline.tracks.find((track) => track.id === trackId).transitions.length, 1);
    await page.screenshot({ path: `${directory}/effect-timeline.png`, fullPage: true });

    await page.getByRole('button', { name: 'Undo last AI turn', exact: true }).click();
    assert.deepEqual(await exportEdit(), trimmed);
    await page.getByText('Edit JSON & reusable presets', { exact: true }).click();
    await page.getByRole('button', { name: 'Redo edit', exact: true }).click();
    await page.getByText('Edit JSON & reusable presets', { exact: true }).click();
    assert.deepEqual(await exportEdit(), edited);
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${directory}/edit.json`, JSON.stringify(edited, null, 2));
    fs.writeFileSync(`${directory}/tool-trace.json`, JSON.stringify(traces, null, 2));
    const summary = { baseURL, settingsInDialog: true, settingsCloseAndReopen: true, chatDraftPreserved: true, realMediaImport: true, libraryToTimeline: true, trim: true, split: true, transition: true, vignetteAlias: true, effectUpdate: true, undoRedo: true, requestCount, pageErrors: errors, liveModelTested: false };
    fs.writeFileSync(`${directory}/results.json`, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
