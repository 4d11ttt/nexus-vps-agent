export interface PackageManagerInput {
  action: 'check' | 'install' | 'remove' | 'update';
  package?: string;
  updateMetadata?: boolean;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
