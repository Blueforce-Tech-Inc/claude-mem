import { expect, it } from 'bun:test';
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = Bun.which('google-chrome') ?? Bun.which('chromium')
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);

for (const key of ['Enter', 'Space'] as const) {
  (chrome ? it : it.skip)(`activates session buttons with native ${key} without opening the card`, async () => {
    const session = { content_session_id: 'owned-session', platform_source: 'claude',
      project: 'owned-project', custom_title: null, item_count: 1, started_at_epoch: Date.now() };
    const bundle = await build({
      write: false, bundle: true, platform: 'browser', format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"' },
      stdin: { resolveDir: resolve(import.meta.dir, '../../..'), loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { SessionCard } from './src/ui/viewer/components/SessionCard';
        window.opens = 0; window.deletes = 0; window.confirm = () => true;
        createRoot(document.getElementById('root')).render(<SessionCard session={${JSON.stringify(session)}}
          onOpen={() => window.opens++} onDelete={async () => { window.deletes++; }} />);
      ` },
    });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      return new URL(request.url).pathname === '/fixture.js'
        ? new Response(bundle.outputFiles[0].text, { headers: { 'Content-Type': 'application/javascript' } })
        : new Response('<div id="root"></div><script src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    } });
    const profile = mkdtempSync(join(tmpdir(), 'claude-mem-session-keyboard-'));
    const child = Bun.spawn([chrome!, '--headless', '--no-sandbox', '--disable-gpu',
      '--disable-background-networking', '--no-first-run', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, server.url.href], { stdout: 'ignore', stderr: 'ignore' });
    let socket: WebSocket | undefined;
    try {
      const startupDeadline = Date.now() + 10000;
      const portFile = join(profile, 'DevToolsActivePort');
      let port = '';
      while (!/^\d+$/.test(port)) {
        if (Date.now() > startupDeadline) throw new Error('Owned browser did not start');
        if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0];
        if (!/^\d+$/.test(port)) await Bun.sleep(10);
      }
      const targetResponse = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!targetResponse.ok) throw new Error(`DevTools target lookup failed: HTTP ${targetResponse.status}`);
      const targets = await targetResponse.json();
      const target = targets.find((entry: any) => entry.type === 'page' && entry.url === server.url.href);
      if (!target) throw new Error('Owned browser page was not found');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), 5000);
        socket!.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        socket!.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('CDP connection failed'));
        }, { once: true });
      });
      let id = 0;
      const pending = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
      }>();
      socket.addEventListener('message', event => {
        const data = JSON.parse(String(event.data));
        const request = pending.get(data.id);
        if (request) {
          pending.delete(data.id);
          clearTimeout(request.timeout);
          if (data.error) request.reject(new Error(data.error.message));
          else request.resolve(data.result);
        }
      });
      const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`CDP request timed out: ${method}`));
        }, 5000);
        pending.set(requestId, { resolve, reject, timeout });
        socket!.send(JSON.stringify({ id: requestId, method, params }));
      });
      const evaluate = async (expression: string) => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      };
      const waitFor = async (expression: string, description: string) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (await evaluate(expression)) return;
          await Bun.sleep(25);
        }
        throw new Error(`Timed out waiting for ${description}`);
      };
      const press = async (value: 'Enter' | 'Space' | 'Escape') => {
        const code = value === 'Enter' ? 13 : value === 'Space' ? 32 : 27;
        const event = { key: value === 'Space' ? ' ' : value, code: value,
          windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
        const text = value === 'Enter' ? '\r' : value === 'Space' ? ' ' : undefined;
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text, unmodifiedText: text });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
      };
      const renderDeadline = Date.now() + 10000;
      while (!await evaluate('!!document.querySelector(".session-card")')) {
        if (Date.now() > renderDeadline) throw new Error('Session card did not render');
        await Bun.sleep(10);
      }
      await evaluate('document.querySelector(".session-card").focus()'); await press(key);
      await waitFor('window.opens === 1', 'session card keyboard activation');
      const ownCardOpens = await evaluate('window.opens');
      await evaluate('window.opens=0;document.querySelector(".session-card-menu-trigger").focus()');
      await press(key);
      await waitFor('!!document.querySelector(".session-card-menu") || window.opens !== 0', 'session action button activation');
      const buttonOpens = await evaluate('window.opens');
      const menuOpened = await evaluate('!!document.querySelector(".session-card-menu")');
      // Keep the later native Delete regression observable even on the broken baseline.
      if (!menuOpened) {
        await evaluate('document.querySelector(".session-card-menu-trigger").click()');
        await waitFor('!!document.querySelector(".session-card-menu")', 'session actions menu opening');
      }
      await press('Escape');
      await waitFor('!document.querySelector(".session-card-menu")', 'Escape menu dismissal');
      const escaped = await evaluate('!document.querySelector(".session-card-menu")');
      await evaluate('document.querySelector(".session-card-menu-trigger").click()');
      await waitFor('!!document.querySelector(".session-card-menu")', 'session actions menu reopening');
      await evaluate('window.opens=0;document.querySelector(".session-card-menu-item--danger").focus()');
      await press(key);
      await waitFor('window.deletes === 1 || window.opens !== 0', 'delete menu keyboard activation');
      const deleteOpens = await evaluate('window.opens');
      const deletes = await evaluate('window.deletes');
      expect({ ownCardOpens, buttonOpens, menuOpened, deleteOpens, deletes, escaped }).toEqual({
        ownCardOpens: 1, buttonOpens: 0, menuOpened: true, deleteOpens: 0, deletes: 1, escaped: true,
      });
    } finally {
      socket?.close(); child.kill(); await child.exited; server.stop(true);
      rmSync(profile, { recursive: true, force: true });
    }
  }, 30000);
}
