import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    // App Router entry points (Next.js auto-discovers these)
    'src/app/**/{page,layout,error,loading,not-found,route}.{ts,tsx}',
    // MCP server — run as a standalone process via `node mcp/server.ts`
    'mcp/server.ts',
  ],
  // factory/ entry points come from the package.json factory* scripts
  project: ['src/**/*.{ts,tsx}', 'mcp/**/*.ts', 'factory/**/*.ts'],
  ignore: [
    // shadcn/ui components export their full public API — consumers may import any member.
    // Knip can't know which exports are used externally, so we exclude the ui/ barrel.
    'src/components/ui/**',
    // MCP brief types are exported for the MCP server's external consumers.
    'mcp/brief.ts',
    // approval-tokens exports the full public API for signed one-time approval links.
    // buildApprovalUrl is called by the notification dispatcher at runtime.
    'src/lib/approval-tokens.ts',
  ],
  ignoreExportsUsedInFile: true,
  // System tools the factory sandbox spawns (factory/lib/sandbox.ts streams the clone in with tar).
  ignoreBinaries: ['tar'],
  ignoreDependencies: [
    // tailwindcss and tw-animate-css are imported via CSS @import in globals.css.
    // Knip only parses JS/TS imports so it flags these as unused — they are not.
    'tailwindcss',
    'tw-animate-css',
  ],
}

export default config
