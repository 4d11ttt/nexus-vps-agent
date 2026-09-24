import { describe, it, expect } from 'vitest';
import { TelegramFormatter } from '../../src/telegram/TelegramFormatter.js';

const formatter = new TelegramFormatter();

describe('TelegramFormatter', () => {
  describe('system information', () => {
    it('formats the prose system summary from the LLM', () => {
      const input =
        '**Hostname:** `armbian`\n' +
        'Detail server:\n' +
        '- Hostname: **armbian**\n' +
        '- Platform: Linux, **arm64** (aarch64)\n' +
        '- Kernel: **6.18.53-ophub**\n' +
        '- CPU: 4 core\n' +
        '- RAM: 1.87 GiB\n' +
        '- Uptime: 66 menit';

      const chunks = formatter.formatSystemInfo(input);
      const html = chunks.map((c) => c.text).join('\n');

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('🖥️');
      expect(html).toContain('<b>Server Information</b>');
      expect(html).toContain('<code>armbian</code>');
      expect(html).toContain('Hostname:');
      expect(html).toContain('Platform:');
      expect(html).toContain('Kernel:');
      expect(html).toContain('CPU:');
      expect(html).toContain('RAM:');
      expect(html).toContain('✓ <i>Completed</i>');
    });

    it('formats raw system_info tool JSON', () => {
      const input = JSON.stringify({
        hostname: 'armbian',
        platform: 'linux',
        architecture: 'arm64',
        release: '6.18.53-ophub',
        version: '#1 SMP',
        cpuCount: 4,
        memoryTotal: 2_052_657_152,
        uptime: 3960,
      });

      const chunks = formatter.formatResponse(input, { finishReason: 'completed', toolCalls: 1 });
      const html = chunks.map((c) => c.text).join('\n');

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('🖥️ <b>Server Information</b>');
      expect(html).toContain('<code>armbian</code>');
      expect(html).toContain('<code>4 cores</code>');
      expect(html).toContain('<code>1h 06m</code>');
      expect(html).toContain('Platform:');
    });

    it('omits optional fields that are missing', () => {
      const input = JSON.stringify({ hostname: 'box', platform: 'linux', architecture: 'x64', release: '5.0' });
      const chunks = formatter.formatSystemInfo(input);
      const html = chunks[0].text;
      expect(html).not.toContain('CPU');
      expect(html).not.toContain('RAM');
      expect(html).toContain('<code>box</code>');
    });
  });

  describe('resources', () => {
    it('formats raw system_resources tool JSON', () => {
      const input = JSON.stringify({
        memoryTotal: 2_052_657_152,
        memoryFree: 1_757_184_000,
        memoryUsed: 295_473_152,
        cpuCount: 4,
        loadAverage: [1.17, 0.81, 0.62],
        uptime: 3960,
      });

      const chunks = formatter.formatResources(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('📊 <b>System Resources</b>');
      expect(html).toContain('RAM:');
      expect(html).toContain('<b>14%</b>');
      expect(html).toContain('CPU:');
      expect(html).toContain('<code>4 cores · Load 1.17</code>');
    });
  });

  describe('speedtest', () => {
    it('formats speedtest JSON', () => {
      const input = JSON.stringify({
        download: '42.31 Mbps',
        upload: '18.72 Mbps',
        ping: '24 ms',
        jitter: '3 ms',
        server: 'Jakarta',
      });

      const chunks = formatter.formatSpeedtest(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('⚡ <b>Speedtest</b>');
      expect(html).not.toContain('<pre>');
      expect(html).toContain('Download: <b>42.31 Mbps</b>');
      expect(html).toContain('Upload: <b>18.72 Mbps</b>');
      expect(html).toContain('Ping: <b>24 ms</b>');
      expect(html).toContain('Server: <code>Jakarta</code>');
    });
  });

  describe('shell output', () => {
    it('formats shell tool JSON with command and output', () => {
      const input = JSON.stringify({
        command: 'uname -a',
        stdout: 'Linux armbian 6.18.53-ophub ...',
        stderr: '',
        exitCode: 0,
        durationMs: 12,
        timedOut: false,
      });

      const chunks = formatter.formatShell(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('🔧 <b>Command</b>');
      expect(html).toContain('<pre>uname -a</pre>');
      expect(html).toContain('<b>Output</b>');
      expect(html).toContain('<pre>Linux armbian 6.18.53-ophub ...</pre>');
    });

    it('splits very long shell output into multiple messages', () => {
      const input = JSON.stringify({
        command: 'cat big.log',
        stdout: 'line\n'.repeat(2000),
        stderr: '',
        exitCode: 0,
      });

      const chunks = formatter.formatShell(input);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.parseMode).toBe('HTML');
        expect(chunk.text.length).toBeLessThanOrEqual(4096);
      }
    });
  });

  describe('filesystem', () => {
    it('formats filesystem list JSON as a tree', () => {
      const input = JSON.stringify({
        path: '/opt/nexus-vps-agent',
        items: [
          { name: 'src', type: 'directory' },
          { name: 'data', type: 'directory' },
          { name: 'package.json', type: 'file' },
          { name: 'README.md', type: 'file' },
        ],
      });

      const chunks = formatter.formatFilesystem(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('📁 <b>Files</b>');
      expect(html).not.toContain('<pre>');
      expect(html).toContain('/opt/nexus-vps-agent');
      expect(html).toContain('<code>src</code>');
      expect(html).toContain('<code>README.md</code>');
      expect(html).toContain('•');
    });
  });

  describe('processes', () => {
    it('formats process list JSON', () => {
      const input = JSON.stringify({
        count: 2,
        processes: [
          { pid: 15210, command: 'node', memory: 50_331_648 },
          { pid: 1, command: 'systemd', memory: 12_288_000 },
        ],
      });

      const chunks = formatter.formatProcesses(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('⚙️ <b>Processes</b>');
      expect(html).not.toContain('<pre>');
      expect(html).toContain('<code>15210</code>');
      expect(html).toContain('<code>node</code>');
    });
  });

  describe('package manager', () => {
    it('formats apt update JSON', () => {
      const input = JSON.stringify({
        action: 'update',
        success: true,
        exitCode: 0,
        stdout: 'Hit:1 http://deb.debian.org/debian bookworm InRelease',
        stderr: '',
      });

      const chunks = formatter.formatPackageManager(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('📦 <b>Package Manager</b>');
      expect(html).toContain('Command: <code>apt update</code>');
      expect(html).toContain('Exit code: <code>0</code>');
      expect(html).toContain('Hit:1 http://deb.debian.org/debian bookworm InRelease');
    });
  });

  describe('errors', () => {
    it('formats error responses safely', () => {
      const chunks = formatter.formatError('Command not found: foobar');
      const html = chunks.map((c) => c.text).join('\n');

      expect(html).toContain('❌ <b>Command failed</b>');
      expect(html).toContain('<code>Command not found: foobar</code>');
      expect(html).not.toContain('<pre>');
    });

    it('wraps multi-line errors in a pre block', () => {
      const chunks = formatter.formatError('Error: nginx failed\nexit code 1\nstderr');
      const html = chunks.map((c) => c.text).join('\n');

      expect(html).toContain('❌ <b>Command failed</b>');
      expect(html).toContain('<pre>');
    });
  });

  describe('HTML safety', () => {
    it('escapes HTML special characters in values', () => {
      const input = JSON.stringify({
        hostname: 'box <script>',
        platform: 'linux & more',
        architecture: 'x64 "quoted"',
        release: '5.0',
      });
      const chunks = formatter.formatSystemInfo(input);
      const html = chunks[0].text;
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;quoted&quot;');
      expect(html).not.toContain('<script>');
    });

    it('escapes shell output containing angle brackets', () => {
      const input = JSON.stringify({
        command: 'echo',
        stdout: 'a < b > c',
        stderr: '',
        exitCode: 0,
      });
      const chunks = formatter.formatShell(input);
      const html = chunks[0].text;
      expect(html).toContain('&lt; b &gt;');
      expect(html).not.toContain('a < b > c');
    });
  });

  describe('generic responses', () => {
    it('keeps plain conversational text unchanged', () => {
      const chunks = formatter.formatResponse('nginx belum terpasang.');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('nginx belum terpasang.');
      expect(chunks[0].parseMode).toBeUndefined();
    });

    it('converts markdown to HTML when present', () => {
      const input = '**Done.**\n\n- nginx installed\n- service running\n\nUse `systemctl status nginx`.';
      const chunks = formatter.formatGeneric(input);
      const html = chunks[0].text;

      expect(chunks[0].parseMode).toBe('HTML');
      expect(html).toContain('<b>Done.</b>');
      expect(html).toContain('• nginx installed');
      expect(html).toContain('<code>systemctl status nginx</code>');
    });

    it('converts markdown code blocks to pre tags', () => {
      const input = 'Example:\n```\nuname -a\n```';
      const chunks = formatter.formatGeneric(input);
      const html = chunks[0].text;
      expect(html).toContain('<pre>uname -a</pre>');
    });
  });

  describe('long responses', () => {
    it('splits a long generic response without corrupting HTML', () => {
      const input = '**Start** ' + 'word '.repeat(2000);
      const chunks = formatter.formatGeneric(input);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.parseMode).toBe('HTML');
        expect(chunk.text.length).toBeLessThanOrEqual(4096);
      }
    });
  });

  describe('markdown cleanup', () => {
    it('never shows raw markdown asterisks in formatted output', () => {
      const input = '**Hostname:** `armbian`\n- Platform: **linux**\n- RAM: **1.87 GiB**';
      const chunks = formatter.formatGeneric(input);
      const html = chunks.map((c) => c.text).join('\n');
      expect(html).not.toContain('**');
      expect(html).toContain('<b>Hostname:</b>');
      expect(html).toContain('<code>armbian</code>');
    });

    it('strips markdown from speedtest prose and formats it compactly', () => {
      const input =
        '**Speedtest**\n' +
        '- Download: **42.31 Mbps**\n' +
        '- Upload: **18.72 Mbps**\n' +
        '- Ping: **24 ms**\n' +
        '- Server: **Jakarta**';
      const chunks = formatter.formatSpeedtest(input);
      const html = chunks.map((c) => c.text).join('\n');
      expect(html).not.toContain('**');
      expect(html).toContain('Download: <b>42.31 Mbps</b>');
      expect(html).toContain('Upload: <b>18.72 Mbps</b>');
      expect(html).toContain('Ping: <b>24 ms</b>');
      expect(html).toContain('Server: <code>Jakarta</code>');
    });

    it('strips markdown from shell-style pre blocks', () => {
      const input = 'Output:\n**Linux** armbian\n- item one';
      const chunks = formatter.formatShell(input);
      const html = chunks.map((c) => c.text).join('\n');
      expect(html).not.toContain('**');
      expect(html).toContain('Linux armbian');
      expect(html).toContain('• item one');
    });
  });

  describe('edge cases', () => {
    it('returns a default message for empty input', () => {
      const chunks = formatter.formatResponse('');
      expect(chunks[0].text).toBe('Agen tidak memberikan respons.');
    });

    it('handles JSON fields with null or undefined values', () => {
      const input = JSON.stringify({
        hostname: 'box',
        platform: 'linux',
        architecture: null,
        release: undefined,
        cpuCount: 0,
      });
      const chunks = formatter.formatSystemInfo(input);
      const html = chunks[0].text;
      expect(html).toContain('<code>box</code>');
      expect(html).toMatch(/linux|null/);
    });
  });
});
