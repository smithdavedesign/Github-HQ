import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    // App Router entry points (Next.js auto-discovers these)
    'src/app/**/{page,layout,error,loading,not-found,route}.{ts,tsx}',
    // MCP server — run as a standalone process via `node mcp/server.ts`
    'mcp/server.ts',
  ],
  project: ['src/**/*.{ts,tsx}', 'mcp/**/*.ts'],
  ignore: [
    // shadcn/ui components export their full public API — consumers may import any member.
    // Knip can't know which exports are used externally, so we exclude the ui/ barrel.
    'src/components/ui/**',
    // MCP brief types are exported for the MCP server's external consumers.
    'mcp/brief.ts',
  ],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: [
    // tailwindcss and tw-animate-css are imported via CSS @import in globals.css.
    // Knip only parses JS/TS imports so it flags these as unused — they are not.
    'tailwindcss',
    'tw-animate-css',
  ],
}

export default config
