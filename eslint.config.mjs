import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      // localStorage/sessionStorage init in useEffect is the correct Next.js pattern to
      // avoid SSR hydration mismatches — calling setState synchronously is intentional here.
      'react-hooks/set-state-in-effect': 'off',
      // Components defined inside server-component render functions are fine in Next.js 16
      // App Router since server components don't re-render — the perf concern doesn't apply.
      'react-hooks/static-components': 'off',
      // TanStack Table's useReactTable() is a genuine React hook — the rule doesn't recognize
      // third-party hook libraries and produces a false positive here.
      'react-hooks/incompatible-library': 'off',
    },
  },
])

export default eslintConfig
