import type { AgentFinishReason } from '../agent/types.js';
import { splitMessage } from './formatter.js';

const MAX_CHUNK_LENGTH = 3800;

const ICON = {
  system: '🖥️',
  resources: '📊',
  storage: '💾',
  network: '🌐',
  speedtest: '⚡',
  packages: '📦',
  files: '📁',
  process: '⚙️',
  command: '🔧',
  scheduler: '⏰',
  memory: '🧠',
  tool: '🛠️',
  success: '✓',
  warning: '⚠️',
  error: '✕',
  processing: '👀',
} as const;

export interface TelegramMessageChunk {
  text: string;
  parseMode: 'HTML' | undefined;
}

interface FormatOptions {
  finishReason?: AgentFinishReason;
  toolCalls?: number;
}

/**
 * Format agent responses into polished, Telegram-safe HTML messages.
 */
export class TelegramFormatter {
  formatResponse(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const trimmed = response.trim();
    if (trimmed.length === 0) {
      return [{ text: 'Agen tidak memberikan respons.', parseMode: undefined }];
    }
    const chunks = this.dispatchFormat(trimmed, options);
    return chunks.length > 0 ? chunks : [{ text: trimmed, parseMode: undefined }];
  }

  private dispatchFormat(response: string, options: FormatOptions): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      const formatted = this.formatJsonObject(json, options);
      if (formatted.length > 0) return formatted;
    }

    if (looksLikeSystemInfo(response)) return this.formatSystemInfo(response, options);
    if (looksLikeResources(response)) return this.formatResources(response, options);
    if (looksLikeSpeedtest(response)) return this.formatSpeedtest(response, options);
    if (looksLikeFilesystem(response)) return this.formatFilesystem(response, options);
    if (looksLikeProcessList(response)) return this.formatProcesses(response, options);
    if (looksLikePackageManager(response)) return this.formatPackageManager(response, options);
    if (looksLikeShellOutput(response)) return this.formatShell(response, options);
    if (looksLikeError(response, options)) return this.formatError(response, options);

    return this.formatGeneric(response, options);
  }

  private formatJsonObject(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    if (
      hasFields(json, ['hostname', 'platform', 'architecture', 'release']) ||
      hasFields(json, ['platform', 'architecture', 'release'])
    ) {
      return this.formatSystemInfoFromJson(json, options);
    }
    if (hasFields(json, ['memoryTotal', 'loadAverage', 'uptime']) && !('hostname' in json)) {
      return this.formatResourcesFromJson(json, options);
    }
    if (hasFields(json, ['download', 'upload', 'ping'])) {
      return this.formatSpeedtestFromJson(json, options);
    }
    if (Array.isArray(json.processes)) {
      return this.formatProcessesFromJson(json, options);
    }
    if (Array.isArray(json.items) && 'path' in json) {
      return this.formatFilesystemFromJson(json, options);
    }
    if (typeof json.command === 'string' && (hasStringField(json, 'stdout') || hasStringField(json, 'stderr'))) {
      return this.formatShellFromJson(json, options);
    }
    if (['update', 'check', 'install', 'remove'].includes(String(json.action))) {
      return this.formatPackageManagerFromJson(json, options);
    }
    if (hasStringField(json, 'stdout') && 'success' in json) {
      return this.formatPackageManagerFromJson(json, options);
    }
    return [];
  }

  formatSystemInfo(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatSystemInfoFromJson(json, options);
    }

    const hostname = extractValue(response, 'Hostname');
    const platform = extractPlatform(response);
    const kernel = extractValue(response, 'Kernel');
    const cpu = extractValue(response, 'CPU');
    const ram = extractValue(response, 'RAM');
    const uptime = extractValue(response, 'Uptime');

    const lines: string[] = [`${ICON.system} ${bold('Server Information')}\n`];
    if (hostname) lines.push(`Hostname: ${code(stripMarkdown(hostname))}`);
    if (platform) lines.push(`Platform: ${code(stripMarkdown(platform))}`);
    if (kernel) lines.push(`Kernel: ${code(stripMarkdown(kernel))}`);
    if (cpu) lines.push(`CPU: ${code(stripMarkdown(cpu))}`);
    if (ram) lines.push(`RAM: ${code(stripMarkdown(ram))}`);
    if (uptime) lines.push(`Uptime: ${code(stripMarkdown(uptime))}`);

    if (lines.length === 1) {
      return this.formatGeneric(response, options);
    }

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  private formatSystemInfoFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const hostname = stringOrUndefined(json.hostname);
    const platform = buildPlatformString(json);
    const kernel = stringOrUndefined(json.release);
    const cpu = json.cpuCount !== undefined ? `${json.cpuCount} cores` : undefined;
    const ram = json.memoryTotal !== undefined ? `${formatBytes(Number(json.memoryTotal))} total` : undefined;
    const uptime = json.uptime !== undefined ? formatUptime(Number(json.uptime)) : undefined;

    const lines: string[] = [`${ICON.system} ${bold('Server Information')}\n`];
    if (hostname) lines.push(`Hostname: ${code(hostname)}`);
    if (platform) lines.push(`Platform: ${code(platform)}`);
    if (kernel) lines.push(`Kernel: ${code(kernel)}`);
    if (cpu) lines.push(`CPU: ${code(cpu)}`);
    if (ram) lines.push(`RAM: ${code(ram)}`);
    if (uptime) lines.push(`Uptime: ${code(uptime)}`);

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  formatResources(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatResourcesFromJson(json, options);
    }

    const lines: string[] = [`${ICON.resources} ${bold('System Resources')}\n`];
    const ram = extractValue(response, 'RAM');
    if (ram) lines.push(`RAM: ${codeLine(ram)}`);
    const cpu = extractValue(response, 'CPU');
    if (cpu) lines.push(`CPU: ${codeLine(cpu)}`);
    const uptime = extractValue(response, 'Uptime');
    if (uptime) lines.push(`Uptime: ${codeLine(uptime)}`);

    if (lines.length === 1) {
      return this.formatGeneric(response, options);
    }

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  private formatResourcesFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const total = Number(json.memoryTotal ?? 0);
    const used = Number(json.memoryUsed ?? 0);
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    const load = Array.isArray(json.loadAverage) ? json.loadAverage : [];
    const load1m = load[0] !== undefined ? Number(load[0]).toFixed(2) : undefined;

    const lines: string[] = [`${ICON.resources} ${bold('System Resources')}\n`];
    lines.push(`RAM: ${code(`${formatBytes(used)} / ${formatBytes(total)}`)} · <b>${percent}%</b>`);
    const cpuParts: string[] = [];
    if (json.cpuCount !== undefined) cpuParts.push(`${json.cpuCount} cores`);
    if (load1m !== undefined) cpuParts.push(`Load ${load1m}`);
    if (cpuParts.length > 0) {
      lines.push(`CPU: ${code(cpuParts.join(' · '))}`);
    }
    if (json.uptime !== undefined) {
      lines.push(`Uptime: ${code(formatUptime(Number(json.uptime)))}`);
    }

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  formatSpeedtest(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatSpeedtestFromJson(json, options);
    }

    const clean = stripMarkdownBlock(response);
    const download = extractValueLoose(clean, 'Download');
    const upload = extractValueLoose(clean, 'Upload');
    const ping = extractValueLoose(clean, 'Ping');
    const jitter = extractValueLoose(clean, 'Jitter');
    const server = extractValueLoose(clean, 'Server');

    if (download || upload || ping) {
      return this.buildSpeedtestChunks(download, upload, ping, jitter, server, options);
    }

    const preBlock = extractPreformattedBlock(response) ?? clean;
    return this.buildBlockChunks('Speedtest', ICON.speedtest, preBlock, options);
  }

  private formatSpeedtestFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    return this.buildSpeedtestChunks(
      stringOrUndefined(json.download),
      stringOrUndefined(json.upload),
      stringOrUndefined(json.ping),
      stringOrUndefined(json.jitter),
      stringOrUndefined(json.server),
      options,
    );
  }

  private buildSpeedtestChunks(
    download: string | undefined,
    upload: string | undefined,
    ping: string | undefined,
    jitter: string | undefined,
    server: string | undefined,
    options: FormatOptions,
  ): TelegramMessageChunk[] {
    const lines: string[] = [`${ICON.speedtest} ${bold('Speedtest')}\n`];
    if (download) lines.push(`Download: <b>${escapeHtml(stripMarkdown(download))}</b>`);
    if (upload) lines.push(`Upload: <b>${escapeHtml(stripMarkdown(upload))}</b>`);
    if (ping) lines.push(`Ping: <b>${escapeHtml(stripMarkdown(ping))}</b>`);
    if (jitter) lines.push(`Jitter: <b>${escapeHtml(stripMarkdown(jitter))}</b>`);
    if (server) lines.push(`\nServer: ${code(stripMarkdown(server))}`);

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  formatFilesystem(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && Array.isArray(json.items) && typeof json.path === 'string') {
      return this.formatFilesystemFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? stripMarkdownBlock(response);
    return this.buildBlockChunks('Files', ICON.files, preBlock, options);
  }

  private formatFilesystemFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const path = String(json.path ?? '');
    const items = Array.isArray(json.items) ? (json.items as Array<Record<string, unknown>>) : [];

    const lines: string[] = [`${ICON.files} ${bold('Files')}\n`];
    if (path) lines.push(`Path: ${code(path)}\n`);
    for (const item of items.slice(0, 100)) {
      const name = String(item.name ?? '');
      const type = String(item.type ?? 'file');
      const icon = type === 'directory' ? '📁' : '📄';
      if (name) lines.push(`• ${icon} ${code(name)}`);
    }

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  formatProcesses(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && Array.isArray(json.processes)) {
      return this.formatProcessesFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? stripMarkdownBlock(response);
    return this.buildBlockChunks('Processes', ICON.process, preBlock, options);
  }

  private formatProcessesFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const processes = Array.isArray(json.processes) ? (json.processes as Array<Record<string, unknown>>) : [];
    const lines: string[] = [`${ICON.process} ${bold('Processes')}\n`];
    for (const p of processes.slice(0, 50)) {
      const pid = String(p.pid ?? '');
      const mem = p.memory !== undefined ? formatBytes(Number(p.memory)) : '';
      const cmd = String(p.command ?? '').slice(0, 60);
      const parts = [`PID ${code(pid)}`];
      if (mem) parts.push(`MEM ${code(mem)}`);
      parts.push(`CMD ${code(cmd)}`);
      lines.push(`• ${parts.join(' · ')}`);
    }
    if (processes.length === 0) lines.push('No processes found.');

    return this.wrapHtmlChunk(lines.join('\n') + this.footerHtml(options));
  }

  formatPackageManager(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatPackageManagerFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? stripMarkdownBlock(response);
    return this.buildBlockChunks('Package Manager', ICON.packages, preBlock, options);
  }

  private formatPackageManagerFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const action = String(json.action ?? 'run');
    const pkg = json.package !== undefined ? String(json.package) : undefined;
    const success = json.success === true;
    const exitCode = json.exitCode !== undefined ? Number(json.exitCode) : undefined;

    const lines: string[] = [`${ICON.packages} ${bold('Package Manager')}\n`];
    lines.push(`Command: ${code(pkg ? `apt ${action} ${pkg}` : `apt ${action}`)}`);
    if (exitCode !== undefined) lines.push(`Exit code: ${code(String(exitCode))}`);

    const stdout = hasStringField(json, 'stdout') ? String(json.stdout).trim() : '';
    const stderr = hasStringField(json, 'stderr') ? String(json.stderr).trim() : '';
    if (stdout.length > 0) lines.push(`\nOutput:\n<pre>${escapeHtml(stdout.slice(0, 1200))}</pre>`);
    if (stderr.length > 0) lines.push(`\nStderr:\n<pre>${escapeHtml(stderr.slice(0, 1200))}</pre>`);

    return this.wrapHtmlChunk(lines.join('') + this.footerHtml(options, success ? 'Packages processed' : undefined));
  }

  formatShell(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && typeof json.command === 'string') {
      return this.formatShellFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? stripMarkdownBlock(response);
    const chunks = splitMessage(preBlock, MAX_CHUNK_LENGTH).map((block) => pre(block));
    return this.buildMultiPreChunks('Command', ICON.command, undefined, chunks, options);
  }

  private formatShellFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const command = String(json.command ?? '');
    const stdout = hasStringField(json, 'stdout') ? String(json.stdout) : '';
    const stderr = hasStringField(json, 'stderr') ? String(json.stderr) : '';
    const combined = stdout + (stderr.length > 0 ? '\n' + stderr : '');
    const output = combined.trim().length > 0 ? combined.trim() : '(no output)';
    const outputBlocks = splitMessage(output, MAX_CHUNK_LENGTH).map((block) => pre(block));
    return this.buildMultiPreChunks('Command', ICON.command, command, outputBlocks, options);
  }

  formatError(response: string, _options: FormatOptions = {}): TelegramMessageChunk[] {
    const clean = stripMarkdownBlock(response.trim());
    const header = `❌ <b>Command failed</b>\n\n`;

    // Short, single-line errors: keep them as normal text.
    if (!clean.includes('\n') && clean.length <= 120) {
      return this.wrapHtmlChunk(header + code(clean));
    }

    // Multi-line or long errors: only the actual error output goes into <pre>.
    return this.wrapHtmlChunk(header + pre(clean));
  }

  formatGeneric(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    // Fast path: short plain text without any markdown-looking content.
    // Plain-text responses containing '*' still go through conversion below so
    // stray Markdown asterisks are never shown literally.
    if (!/(\*\*|`|```|^[-*]\s+|^#{1,6}\s+|^\d+\.\s+|\*[^*\n]+\*)/m.test(response)) {
      // Plain text with no markup; keep it simple and do not force a footer.
      return splitMessage(response, MAX_CHUNK_LENGTH).map((chunk) => ({
        text: chunk,
        parseMode: undefined,
      }));
    }

    const converted = markdownToHtml(response);
    if (converted === undefined) {
      // Plain text with no markup; keep it simple and do not force a footer.
      return splitMessage(response, MAX_CHUNK_LENGTH).map((chunk) => ({
        text: chunk,
        parseMode: undefined,
      }));
    }

    const footer = this.footerHtml(options);
    return this.wrapHtmlChunk(converted + footer);
  }

  private buildBlockChunks(
    title: string,
    icon: string,
    block: string,
    options: FormatOptions,
  ): TelegramMessageChunk[] {
    const blocks = splitMessage(block.trim(), MAX_CHUNK_LENGTH).map((chunk) => pre(chunk));
    return this.buildMultiPreChunks(title, icon, undefined, blocks, options);
  }

  private buildMultiPreChunks(
    title: string,
    icon: string,
    command: string | undefined,
    blocks: string[],
    options: FormatOptions,
  ): TelegramMessageChunk[] {
    if (blocks.length === 0) {
      blocks.push(pre('(no output)'));
    }

    const chunks: TelegramMessageChunk[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const parts: string[] = [];
      if (i === 0) {
        parts.push(`${icon} ${bold(title)}\n`);
        if (command !== undefined && command.length > 0) {
          parts.push(`\n${bold('Command')}\n${pre(command)}`);
        }
      }
      parts.push(i === 0 && command ? `\n${bold('Output')}\n${blocks[i]}` : `\n${blocks[i]}`);
      if (i === blocks.length - 1) {
        parts.push(this.footerHtml(options));
      }
      chunks.push({ text: parts.join(''), parseMode: 'HTML' });
    }
    return chunks;
  }

  private wrapHtmlChunk(html: string): TelegramMessageChunk[] {
    return splitMessage(html, MAX_CHUNK_LENGTH).map((chunk) => ({ text: chunk, parseMode: 'HTML' as const }));
  }

  private footerHtml(options: FormatOptions, overrideText?: string): string {
    const { icon, text } = this.resolveFooter(options, overrideText);
    return `\n${icon} ${italic(text)}`;
  }

  private resolveFooter(options: FormatOptions, overrideText?: string): { icon: string; text: string } {
    if (overrideText) {
      return { icon: ICON.success, text: overrideText };
    }
    switch (options.finishReason) {
      case 'error':
        return { icon: ICON.error, text: 'Failed to process request.' };
      case 'iteration_limit':
        return { icon: ICON.warning, text: 'Iteration limit reached.' };
      case 'aborted':
        return { icon: ICON.warning, text: 'Aborted.' };
      case 'completed':
      default:
        return { icon: ICON.success, text: 'Completed' };
    }
  }
}


function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

function italic(text: string): string {
  return `<i>${escapeHtml(text)}</i>`;
}

function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

function codeLine(text: string): string {
  return code(stripMarkdown(text));
}

function pre(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(>"'])\*([^*\n<>]+)\*(?=[\s).,!?;:'"<]|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
    .trim();
}

/**
 * Remove visible Markdown markers from a multi-line block that will be rendered
 * inside a <pre> element. Telegram HTML has no Markdown, so raw `**`, `*`, and
 * backticks would otherwise be shown literally to the user.
 */
function stripMarkdownBlock(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(>"'])\*([^*\n<>]+)\*(?=[\s).,!?;:'"<]|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\*+\s*/gm, '')
    .replace(/\s*\*+$/gm, '')
    .trim();
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasFields(obj: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => field in obj);
}

function hasStringField(obj: Record<string, unknown>, field: string): boolean {
  return typeof obj[field] === 'string';
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : String(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function buildPlatformString(json: Record<string, unknown>): string | undefined {
  const platform = stringOrUndefined(json.platform);
  const arch = stringOrUndefined(json.architecture);
  const version = stringOrUndefined(json.version);
  const parts: string[] = [];
  if (platform) parts.push(platform);
  if (arch) parts.push(arch);
  if (version) parts.push(`(${version})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractValue(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^[^\\n]*${label}[：:]\\s*(.+)$`, 'im');
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = match[1].trim();
  return value.length > 0 ? value : undefined;
}

/**
 * Extract a value from a line that may or may not contain a colon.
 * Useful for tool output such as `Download  42.31 Mbps`.
 */
function extractValueLoose(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\s*(?:[-*•]\\s*)?${label}\\s*[:=]?\\s*(.+)$`, 'im');
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = match[1].trim();
  return value.length > 0 ? value : undefined;
}

function extractPlatform(text: string): string | undefined {
  return extractValue(text, 'Platform');
}

function extractPreformattedBlock(text: string): string | undefined {
  const match = text.match(/```(?:\w*\n)?([\s\S]*?)```/);
  return match ? match[1].trim() : undefined;
}

function looksLikeSystemInfo(text: string): boolean {
  const lower = text.toLowerCase();
  return (lower.includes('hostname') && lower.includes('platform')) || (lower.includes('hostname') && lower.includes('kernel'));
}

function looksLikeResources(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('ram') && lower.includes('cpu') && lower.includes('uptime');
}

function looksLikeSpeedtest(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('download') && lower.includes('upload') && lower.includes('ping');
}

function looksLikeFilesystem(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('├──') || lower.includes('└──') || /\/(?:[\w.-]+\/)*[\w.-]+/.test(text);
}

function looksLikeProcessList(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('pid') && (lower.includes('command') || lower.includes('process'));
}

function looksLikePackageManager(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('apt') || lower.includes('package_manager') || lower.includes('dpkg');
}

function looksLikeShellOutput(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('output') || lower.includes('stdout') || lower.includes('stderr') || /^\$\s/m.test(text);
}

function looksLikeError(text: string, options: FormatOptions): boolean {
  return options.finishReason === 'error' || /^error[：:]/i.test(text);
}

function markdownToHtml(text: string): string | undefined {
  if (!/(\*\*|`|```|^[-*]\s+|^#{1,6}\s+|^\d+\.\s+)/m.test(text)) {
    return undefined;
  }

  // Escape raw text first so that any HTML metacharacters in the original
  // content are safe. Markup tokens themselves are not affected by escaping.
  let html = escapeHtml(text);

  const placeholders: string[] = [];
  const pushPlaceholder = (rendered: string): string => {
    placeholders.push(rendered);
    return `\x00PH_${placeholders.length - 1}\x00`;
  };

  html = html.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, content: string) =>
    pushPlaceholder(pre(content.trim())),
  );
  html = html.replace(/`([^`\n]+)`/g, (_, content: string) => pushPlaceholder(code(content)));
  html = html.replace(/\*\*(.+?)\*\*/g, (_, content: string) => pushPlaceholder(bold(content)));
  // Single-asterisk emphasis pairs (`*text*`) have no meaning in Telegram HTML
  // and would otherwise be shown literally. Convert before restoring
  // placeholders so asterisks inside code/bold content are never touched.
  // (Underscore markup is intentionally left alone: snake_case identifiers
  // such as `system_info` are common in VPS output and must not be mangled.)
  html = html.replace(/(^|[\s(>"'])\*([^*\n<>]+)\*(?=[\s).,!?;:'"<]|$)/g, (_, prefix: string, content: string) =>
    pushPlaceholder(`${prefix}<i>${content}</i>`),
  );
  html = html.replace(/\x00PH_(\d+)\x00/g, (_, index: string) => placeholders[Number(index)]);
  html = html.replace(/(?:^|\n)#{1,6}\s+([^\n]+)/g, (_, content: string) => `\n<b>${content.trim()}</b>`);
  html = html.replace(/(?:^|\n)-\s+([^\n]+)/g, (_, content: string) => `\n• ${content}`);
  html = html.replace(/(?:^|\n)\*\s+([^\n]+)/g, (_, content: string) => `\n• ${content}`);
  html = html.replace(/(?:^|\n)\d+\.\s+([^\n]+)/g, (_, content: string) => `\n• ${content}`);
  html = html.replace(/\n\n+/g, '\n');

  return html.trim();
}

