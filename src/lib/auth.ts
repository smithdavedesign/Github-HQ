import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { db } from '@/lib/db'
import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'repo read:user read:org read:project read:packages security_events',
        },
      },
    }),
  ],
  session: { strategy: 'database' },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
    async signIn({ user, account }) {
      // Store the GitHub access token on the user record for API calls
      if (account?.provider === 'github' && account.access_token && user.id) {
        await db
          .update(users)
          .set({ githubToken: account.access_token })
          .where(eq(users.id, user.id))
      }
      return true
    },
  },
  pages: {
    signIn: '/login',
  },
})
