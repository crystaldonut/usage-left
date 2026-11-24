export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Area = { name: string; color: string }

export type Pr = { number: number; url: string; state: string; isDraft: boolean }

export type Worktree = {
  name: string
  branch: string
  domains: Area[]
  ticket: { id: string; url: string } | null
  pr: Pr | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-left': {
      limits: Limit[]
      model: string
      effort: string
      worktree: Worktree | null
    }
  }
}
