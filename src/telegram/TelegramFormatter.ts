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

    return this.buildSectionedChunks(
      'Server Information',
      ICON.system,
      [
        {
          title: 'Identity',
          lines: [
            keyValueLine('Hostname', hostname),
            keyValueLine('Platform', platform),
            keyValueLine('Kernel', kernel),
          ].filter((line): line is string => line !== undefined),
        },
        {
          title: 'Hardware',
          lines: [
            keyValueLine('CPU', cpu),
            keyValueLine('RAM', ram),
          ].filter((line): line is string => line !== undefined),
        },
        {
          title: 'Runtime',
          lines: [keyValueLine('Uptime', uptime)].filter((line): line is string => line !== undefined),
        },
      ],
      options,
    );
  }

  private formatSystemInfoFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const hostname = stringOrUndefined(json.hostname);
    const platform = buildPlatformString(json);
    const kernel = stringOrUndefined(json.release);
    const cpu = json.cpuCount !== undefined ? `${json.cpuCount} cores` : undefined;
    const ram = json.memoryTotal !== undefined ? `${formatBytes(Number(json.memoryTotal))} total` : undefined;
    const uptime = json.uptime !== undefined ? formatUptime(Number(json.uptime)) : undefined;

    return this.buildSectionedChunks(
      'Server Information',
      ICON.system,
      [
        {
          title: 'Identity',
          lines: [
            keyValueLine('Hostname', hostname),
            keyValueLine('Platform', platform),
            keyValueLine('Kernel', kernel),
          ].filter((line): line is string => line !== undefined),
        },
        {
          title: 'Hardware',
          lines: [
            keyValueLine('CPU', cpu),
            keyValueLine('RAM', ram),
          ].filter((line): line is string => line !== undefined),
        },
        {
          title: 'Runtime',
          lines: [keyValueLine('Uptime', uptime)].filter((line): line is string => line !== undefined),
        },
      ],
      options,
    );
  }

  formatResources(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatResourcesFromJson(json, options);
    }

    const lines: string[] = [];
    const ram = extractValue(response, 'RAM');
    if (ram) lines.push(`<b>RAM</b>\n${codeLine(ram)}`);
    const cpu = extractValue(response, 'CPU');
    if (cpu) lines.push(`<b>CPU</b>\n${codeLine(cpu)}`);
    const uptime = extractValue(response, 'Uptime');
    if (uptime) lines.push(`<b>Uptime</b>\n${codeLine(uptime)}`);

    return this.buildInfoChunks('System Resources', ICON.resources, lines, options);
  }

  private formatResourcesFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const total = Number(json.memoryTotal ?? 0);
    const used = Number(json.memoryUsed ?? 0);
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    const load = Array.isArray(json.loadAverage) ? json.loadAverage : [];
    const load1m = load[0] !== undefined ? Number(load[0]).toFixed(2) : undefined;

    const lines: string[] = [];
    lines.push(`<b>RAM</b>\n${codeLine(`${formatBytes(used)} / ${formatBytes(total)}`)} · <b>${percent}%</b>`);
    if (load1m !== undefined) {
      lines.push(`<b>CPU</b>\n${codeLine(`Load 1m  ${load1m}`)}`);
    }
    if (json.cpuCount !== undefined) {
      lines.push(codeLine(`${json.cpuCount} cores`));
    }
    if (json.uptime !== undefined) {
      lines.push(`<b>Uptime</b>\n${codeLine(formatUptime(Number(json.uptime)))}`);
    }

    return this.buildInfoChunks('System Resources', ICON.resources, lines, options);
  }
  formatSpeedtest(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatSpeedtestFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? response;
    return this.buildBlockChunks('Speedtest', ICON.speedtest, preBlock, options);
  }

  private formatSpeedtestFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const rows: string[] = [];
    if (json.download !== undefined) rows.push(`Download   ${json.download}`);
    if (json.upload !== undefined) rows.push(`Upload     ${json.upload}`);
    if (json.ping !== undefined) rows.push(`Ping       ${json.ping}`);
    if (json.jitter !== undefined) rows.push(`Jitter     ${json.jitter}`);

    const parts: string[] = [`${ICON.speedtest} ${bold('Speedtest')}\n`];
    if (rows.length > 0) parts.push(pre(rows.join('\n')));
    if (json.server !== undefined) {
      parts.push(`\n${bold('Server')}\n${code(String(json.server))}`);
    }
    return this.wrapHtmlChunk(parts.join('') + this.footerHtml(options));
  }

  formatFilesystem(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && Array.isArray(json.items) && typeof json.path === 'string') {
      return this.formatFilesystemFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? response;
    return this.buildBlockChunks('Files', ICON.files, preBlock, options);
  }

  private formatFilesystemFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const path = String(json.path ?? '');
    const items = Array.isArray(json.items) ? (json.items as Array<Record<string, unknown>>) : [];
    const tree = buildTree(path, items);
    return this.buildBlockChunks('Files', ICON.files, tree, options);
  }

  formatProcesses(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && Array.isArray(json.processes)) {
      return this.formatProcessesFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? response;
    return this.buildBlockChunks('Processes', ICON.process, preBlock, options);
  }

  private formatProcessesFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const processes = Array.isArray(json.processes) ? (json.processes as Array<Record<string, unknown>>) : [];
    const rows: string[] = ['PID     MEM         COMMAND'];
    for (const p of processes.slice(0, 50)) {
      const pid = String(p.pid ?? '').padEnd(7);
      const mem = p.memory !== undefined ? formatBytes(Number(p.memory)).padEnd(11) : ''.padEnd(11);
      const cmd = String(p.command ?? '').slice(0, 60);
      rows.push(`${pid}${mem}${cmd}`);
    }
    return this.buildBlockChunks('Processes', ICON.process, rows.join('\n'), options);
  }

  formatPackageManager(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json)) {
      return this.formatPackageManagerFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? response;
    return this.buildBlockChunks('Package Manager', ICON.packages, preBlock, options);
  }

  private formatPackageManagerFromJson(json: Record<string, unknown>, options: FormatOptions): TelegramMessageChunk[] {
    const action = String(json.action ?? 'run');
    const pkg = json.package !== undefined ? String(json.package) : undefined;
    const success = json.success === true;

    const parts: string[] = [`${ICON.packages} ${bold('Package Manager')}\n`];
    const commandLabel = pkg ? `apt ${action} ${pkg}` : `apt ${action}`;
    parts.push(code(commandLabel));

    const stdout = hasStringField(json, 'stdout') ? String(json.stdout).trim() : '';
    const stderr = hasStringField(json, 'stderr') ? String(json.stderr).trim() : '';
    if (stdout.length > 0 && stdout.length < 800) parts.push(`\n${bold('Output')}\n${pre(stdout)}`);
    if (stderr.length > 0 && stderr.length < 800) parts.push(`\n${bold('Stderr')}\n${pre(stderr)}`);

    const statusText =
      success ? 'Success' : json.exitCode !== undefined && json.exitCode !== 0 ? `Exit code ${json.exitCode}` : 'Completed';
    parts.push(`\n${bold('Status')}\n${code(statusText)}`);

    return this.wrapHtmlChunk(parts.join('') + this.footerHtml(options, success ? 'Packages processed' : undefined));
  }

  formatShell(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
    const json = tryParseJson(response);
    if (isPlainObject(json) && typeof json.command === 'string') {
      return this.formatShellFromJson(json, options);
    }
    const preBlock = extractPreformattedBlock(response) ?? response;
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
    const chunks = splitMessage(response.trim(), MAX_CHUNK_LENGTH);
    const parts: TelegramMessageChunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const header = i === 0 ? `${ICON.error} ${bold('Error')}\n` : '';
      parts.push({ text: header + pre(chunks[i]), parseMode: 'HTML' });
    }
    parts.push({ text: `${ICON.error} ${italic('Gagal memproses permintaan.')}`, parseMode: 'HTML' });
    return parts;
  }

  formatGeneric(response: string, options: FormatOptions = {}): TelegramMessageChunk[] {
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

  private buildInfoChunks(
    title: string,
    icon: string,
    lines: string[],
    options: FormatOptions,
  ): TelegramMessageChunk[] {
    if (lines.length === 0) {
      return this.formatGeneric(title, options);
    }

    const parts: string[] = [`${icon} ${bold(title)}\n`];
    const groupSize = 4;
    for (let i = 0; i < lines.length; i += groupSize) {
      const group = lines.slice(i, i + groupSize);
      if (i > 0) parts.push('\n');
      parts.push(group.join('\n'));
    }

    return this.wrapHtmlChunk(parts.join('') + this.footerHtml(options));
  }
  private buildSectionedChunks(
    title: string,
    icon: string,
    sections: Array<{ title: string; lines: string[] }>,
    options: FormatOptions,
  ): TelegramMessageChunk[] {
    const nonEmpty = sections.filter((section) => section.lines.length > 0);
    if (nonEmpty.length === 0) {
      return this.formatGeneric(title, options);
    }

    const parts: string[] = [`${icon} ${bold(title)}`];
    for (const section of nonEmpty) {
      parts.push(`\n\n<b>${escapeHtml(section.title)}</b>\n${section.lines.join('\n')}`);
    }

    return this.wrapHtmlChunk(parts.join('') + this.footerHtml(options));
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
        return { icon: ICON.error, text: 'Gagal memproses permintaan.' };
      case 'iteration_limit':
        return { icon: ICON.warning, text: 'Batas iterasi tercapai.' };
      case 'aborted':
        return { icon: ICON.warning, text: 'Dibatalkan.' };
      case 'completed':
      default:
        return { icon: ICON.success, text: 'Selesai.' };
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

function keyValueLine(label: string, value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return `• ${escapeHtml(label)} — ${code(stripMarkdown(value))}`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
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

function buildTree(path: string, items: Array<Record<string, unknown>>): string {
  const lines: string[] = [path.endsWith('/') ? path : `${path}/`];
  const sorted = [...items].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const isLast = i === sorted.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const name = String(item.name ?? '');
    const type = String(item.type ?? '');
    lines.push(`${prefix}${type === 'directory' ? `${name}/` : name}`);
  }
  return lines.join('\n');
}

function extractValue(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^[^\\n]*${label}[：:]\\s*(.+)$`, 'im');
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
  if (!/(\*\*|`|```|^[-*]\s+)/m.test(text)) {
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
  html = html.replace(/\x00PH_(\d+)\x00/g, (_, index: string) => placeholders[Number(index)]);
  html = html.replace(/(?:^|\n)-\s+([^\n]+)/g, (_, content: string) => `\n• ${content}`);
  html = html.replace(/\n\n+/g, '\n');

  return html.trim();
}

